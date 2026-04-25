// =============================================================================
// OpenLCB Command Station — wired to JMRI via the library's WebSocket transport
// =============================================================================
//
// Normal flow:
//   * Connect to JMRI → CS root node logs in.
//   * Throttle sends Train-Search (with Allocate) → library fires
//     onTrainSearchNoMatch(searchEventId) → we decode the search + create a
//     virtual Train Node for that DCC addr and return its BigInt ID.
//   * Library emits Producer Identified (via wasm_train_send_search_match,
//     which the C layer calls on our behalf after our return).
//   * Throttle sends Train Control commands → library fires
//     onTrainSpeedChanged / onTrainFunctionChanged / onTrainEmergency* on
//     the matching Train Node → our mock track driver logs what a real DCC
//     command station would emit.
//
// The Debug tools card lets an operator pre-allocate trains manually; not
// used in normal operation.

import {
    OpenLcb, WebSocketTransport, PSI, Event,
    TrainSearchFlag, TrainSearchSpeedSteps, TrainSearchProtocol,
} from '../../src/index.js';

// -----------------------------------------------------------------------------
// UI helpers
// -----------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));

function log(tag, msg) {
    const t = new Date().toISOString().slice(11, 23);
    const el = $('log');
    const cls = `tag-${tag}`;
    el.innerHTML += `<span class="ts">[${t}]</span> <span class="${cls}">${tag.toUpperCase()}</span> ${escapeHtml(msg)}\n`;
    el.scrollTop = el.scrollHeight;
}

function hexDot(big) {
    return big.toString(16).toUpperCase().padStart(12, '0').replace(/(..)(?=..)/g, '$1.');
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

const CS_ROOT_NAME = 'OpenLCB CS (JS)';

const state = {
    baseIdBig: 0x050101010800n,
    addrType: 'short', // short | long | auto
    selectedAddr: null,
    trains: new Map(),       // dccAddr -> trainEntry
    byNodeId: new Map(),     // BigInt nodeId -> dccAddr
    openlcb: null,
    csNode: null,            // CS root node (for global-emergency PCERs)
};

function trainNodeId(addr) {
    return state.baseIdBig | BigInt(addr);
}

function makeTrainEntry(addr, { node, name, long, steps }) {
    return {
        node,
        addr,
        long: !!long,
        name: name || `DCC ${addr}`,
        nodeIdHex: hexDot(node.id),
        speedMps: 0,
        direction: 'fwd',
        functions: new Array(29).fill(0),
        controller: null,
        hb: 'idle',           // idle | ok | warn | err
        lastAct: '—',
        steps: steps ?? 128,
        lastActMs: 0,
    };
}

// -----------------------------------------------------------------------------
// Mock track driver — swap for a real DCC driver (WebSerial / DCC-EX) later
// -----------------------------------------------------------------------------

const trackDriver = {
    setSpeed(entry, mps) {
        const sign = mps >= 0 ? '+' : '';
        log('drv', `DCC ${entry.addr}${entry.long ? 'L' : ''}: ${sign}${mps.toFixed(2)} m/s`);
    },
    setFunction(entry, fnAddr, value) {
        log('drv', `DCC ${entry.addr}: F${fnAddr}=${value}`);
    },
    eStop(entry) {
        log('drv', `DCC ${entry.addr}: ESTOP`);
    },
};

// -----------------------------------------------------------------------------
// Train allocation
// -----------------------------------------------------------------------------

function trainCallbacks() {
    return {
        onLoginComplete: (n) => {
            const e = entryForNode(n);
            if (e) log('ok', `train ${e.name} login complete`);
        },
        onTrainSpeedChanged: (n, speed) => {
            const e = entryForNode(n); if (!e) return;
            const f16 = state.openlcb.float16;
            const mag = f16.getSpeed(speed);
            const reverse = f16.getDirection(speed);
            e.speedMps = reverse ? -mag : mag;
            e.direction = reverse ? 'rev' : 'fwd';
            touchEntry(e);
            trackDriver.setSpeed(e, e.speedMps);
            renderRoster();
        },
        onTrainFunctionChanged: (n, fnAddress, fnValue) => {
            const e = entryForNode(n); if (!e) return;
            if (fnAddress >= 0 && fnAddress < e.functions.length) {
                e.functions[fnAddress] = fnValue ? 1 : 0;
            }
            touchEntry(e);
            trackDriver.setFunction(e, fnAddress, fnValue);
            renderRoster();
        },
        onTrainEmergencyEntered: (n, type) => {
            const e = entryForNode(n); if (!e) return;
            e.speedMps = 0;
            e.hb = 'err';
            touchEntry(e);
            log('ctl', `emergency entered on ${e.name} type=${type}`);
            trackDriver.eStop(e);
            renderRoster();
        },
        onTrainEmergencyExited: (n, type) => {
            const e = entryForNode(n); if (!e) return;
            e.hb = 'ok';
            log('ctl', `emergency cleared on ${e.name} type=${type}`);
            renderRoster();
        },
        onTrainControllerAssigned: (n, controllerNodeId) => {
            const e = entryForNode(n); if (!e) return;
            e.controller = hexDot(controllerNodeId);
            renderRoster();
        },
        onTrainControllerReleased: (n) => {
            const e = entryForNode(n); if (!e) return;
            e.controller = null;
            renderRoster();
        },
        onTrainHeartbeatTimeout: (n) => {
            const e = entryForNode(n); if (!e) return;
            e.hb = 'warn';
            log('err', `heartbeat timeout on ${e.name} — train-side EStop`);
            trackDriver.eStop(e);
            renderRoster();
        },
        onConfigMemRead:  (_n, _a, c, buf) => { buf.fill(0); return c; },
        onConfigMemWrite: (_n, _a, c)       => c,
    };
}

function allocateTrain({ addr, long, steps, name }) {
    if (!state.openlcb) {
        log('err', 'cannot allocate train: not connected');
        return null;
    }
    if (state.trains.has(addr)) {
        log('err', `DCC ${addr} already in roster`);
        return state.trains.get(addr);
    }

    const nodeId = trainNodeId(addr);
    const node = state.openlcb.createNode(nodeId, {
        // PSI.TRAIN_CONTROL triggers automatic train_state allocation.
        protocolSupport: [
            PSI.EVENT_EXCHANGE,
            PSI.SIMPLE_NODE_INFORMATION,
            PSI.TRAIN_CONTROL,
        ],
        consumerCountAutocreate: 0,
        producerCountAutocreate: 0,
        snip: {
            mfgVersion: 1,
            name: name || `DCC ${addr}`,
            model: 'Virtual Train',
            hardwareVersion: '1.0',
            softwareVersion: '0.1',
            userVersion: 1,
        },
    }, trainCallbacks());

    // Configure the train's DCC identity before login completes so
    // Train-Search replies carry the right values.
    try {
        node.train.setDccAddress(addr, !!long);
        node.train.setSpeedSteps(steps ?? 128);
    } catch (e) {
        log('err', `train setup failed: ${e?.message ?? e}`);
    }

    const entry = makeTrainEntry(addr, { node, name, long, steps });
    state.trains.set(addr, entry);
    state.byNodeId.set(nodeId, addr);
    log('ok', `allocated ${entry.name} (DCC ${addr}${long ? ' long' : ''}, ${steps ?? 128}-step) node=${entry.nodeIdHex}`);
    renderRoster();
    return entry;
}

function entryForNode(node) {
    if (!node) return null;
    const addr = state.byNodeId.get(node.id);
    return addr != null ? state.trains.get(addr) : null;
}

function touchEntry(entry) {
    if (!entry) return;
    entry.lastActMs = Date.now();
    entry.lastAct = 'now';
}

// Keep "last activity" labels current without a full re-render storm.
setInterval(() => {
    const now = Date.now();
    let dirty = false;
    for (const e of state.trains.values()) {
        if (!e.lastActMs) continue;
        const secs = Math.max(0, Math.floor((now - e.lastActMs) / 1000));
        const label = secs < 1 ? 'now' : `${secs}s ago`;
        if (label !== e.lastAct) { e.lastAct = label; dirty = true; }
    }
    if (dirty) renderRoster();
}, 1000);

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function setStatus(name) {
    const p = $('statusPill');
    p.className = `pill ${name}`;
    p.textContent = name;
    $('btnConnect').disabled    = name === 'connected' || name === 'connecting';
    $('btnDisconnect').disabled = name !== 'connected';
}

function renderRoster() {
    const body = $('rosterBody');
    body.innerHTML = '';
    const rows = [...state.trains.values()].sort((a, b) => a.addr - b.addr);
    for (const t of rows) {
        const tr = document.createElement('tr');
        tr.dataset.addr = t.addr;
        if (state.selectedAddr === t.addr) tr.classList.add('selected');
        const mph = (t.speedMps * 2.23694).toFixed(1);
        const dirCls = t.direction === 'rev' ? 'dir-rev' : 'dir-fwd';
        tr.innerHTML = `
            <td class="col-addr">${t.addr}</td>
            <td class="col-long">${t.long ? '●' : ''}</td>
            <td class="col-name">${escapeHtml(t.name)}</td>
            <td class="col-speed">${Math.abs(t.speedMps).toFixed(2)} m/s<br><span class="kicker">${Math.abs(mph)} mph</span></td>
            <td class="col-dir ${dirCls}">${t.direction === 'rev' ? 'REV' : 'FWD'}</td>
            <td class="col-fn">${renderFnBits(t.functions)}</td>
            <td class="col-ctrl">${t.controller ?? '—'}</td>
            <td class="col-hb"><span class="hb ${t.hb === 'idle' ? '' : t.hb}"></span> ${t.hb}</td>
            <td class="col-act">${t.lastAct}</td>
        `;
        tr.addEventListener('click', () => selectTrain(t.addr));
        body.appendChild(tr);
    }
}

function renderFnBits(fns) {
    let html = '<div class="fn-bits">';
    for (let i = 0; i < 29; i++) html += `<div class="fn-bit${fns[i] ? ' on' : ''}" title="F${i}"></div>`;
    html += '</div>';
    return html;
}

function selectTrain(addr) {
    state.selectedAddr = addr;
    const t = state.trains.get(addr);
    if (!t) {
        $('selInfo').textContent = 'No train selected.';
        $('selActions').style.display = 'none';
    } else {
        $('selInfo').innerHTML =
            `<b>${escapeHtml(t.name)}</b><br>DCC ${t.addr}${t.long ? ' (long)' : ''} • ${t.steps}-step` +
            `<br><span class="kicker">${t.nodeIdHex}</span>`;
        $('selActions').style.display = 'flex';
    }
    renderRoster();
}

// -----------------------------------------------------------------------------
// Connect / disconnect to JMRI
// -----------------------------------------------------------------------------

$('btnConnect').addEventListener('click', async () => {
    const url = $('url').value.trim();
    const baseHex = $('baseId').value.trim().replace(/[.\s]/g, '');
    if (!url || !baseHex) return;
    state.baseIdBig = BigInt('0x' + baseHex);

    setStatus('connecting');
    log('ok', `connect ${url}, CS base=${hexDot(state.baseIdBig)}`);

    try {
        state.openlcb = await OpenLcb.create({
            transport: new WebSocketTransport({ url }),
            callbacks: {
                onTransportConnect:    () => log('ok', 'transport connected'),
                onTransportDisconnect: () => log('ok', 'transport disconnected'),
                onTransportError:      (err) => log('err', `transport error: ${err?.message ?? err}`),

                // Allocate-on-search — throttle sent a search with the
                // Allocate flag and no existing train matched.
                onTrainSearchNoMatch: (searchEventId) => {
                    const ts = state.openlcb.trainSearch;
                    const digits = ts.extractDigits(searchEventId);
                    const searchAddress = ts.digitsToAddress(digits);
                    const flags = ts.extractFlags(searchEventId);
                    const isLong = !!(flags & TrainSearchFlag.LONG_ADDR) || searchAddress >= 128;
                    const stepBits = flags & 0x03;
                    const steps = stepBits === TrainSearchSpeedSteps.STEPS_14 ? 14
                                 : stepBits === TrainSearchSpeedSteps.STEPS_28 ? 28 : 128;
                    log('ctl', `[DIAG] onTrainSearchNoMatch fired for DCC ${searchAddress}`);
                    const entry = allocateTrain({
                        addr: searchAddress,
                        long: isLong,
                        steps,
                        name: `DCC ${searchAddress}`,
                    });
                    if (!entry) return null;
                    // The new train hasn't logged in yet — its CAN alias
                    // gets allocated asynchronously by the WASM pump.  If
                    // we send the search-match Producer Identified now, it
                    // goes out with source alias 0x000 (no AMD frame yet)
                    // and the throttle can't address it.  Wait for login,
                    // then emit.
                    log('ctl', `[DIAG] arming loginComplete.then() for ${entry.nodeIdHex}`);
                    entry.node.loginComplete.then(() => {
                        log('ctl', `[DIAG] loginComplete fired for ${entry.nodeIdHex} — calling sendSearchMatch`);
                        try { entry.node.train.sendSearchMatch(searchEventId); }
                        catch (e) { log('err', `search-match send failed: ${e?.message ?? e}`); }
                    });
                    return entry.node.id;  // runtime resolves BigInt → node
                },
            },
        });

        // CS root node — SNIP identity + origin for global PCERs.
        state.csNode = state.openlcb.createNode(state.baseIdBig, {
            protocolSupport: [PSI.EVENT_EXCHANGE, PSI.SIMPLE_NODE_INFORMATION],
            consumerCountAutocreate: 0,
            producerCountAutocreate: 0,
            snip: {
                mfgVersion: 1,
                name: CS_ROOT_NAME,
                model: 'Command Station',
                hardwareVersion: '1.0',
                softwareVersion: '0.1',
                userVersion: 1,
            },
        }, {
            onLoginComplete: (n) => {
                log('ok', `CS root node logged in id=${hexDot(n.id)}`);
            },
            onConfigMemRead:  (_n, _a, c, buf) => { buf.fill(0); return c; },
            onConfigMemWrite: (_n, _a, c)       => c,
        });

        await state.openlcb.start();
        setStatus('connected');
        $('csIdent').textContent = `base=${hexDot(state.baseIdBig)}`;
        $('connInfo').textContent = 'Connected; waiting for throttle searches.';
    } catch (err) {
        log('err', `connect failed: ${err?.message ?? err}`);
        setStatus('disconnected');
    }
});

$('btnDisconnect').addEventListener('click', async () => {
    if (state.openlcb) {
        await state.openlcb.stop();
        state.openlcb = null;
        state.csNode = null;
    }
    state.trains.clear();
    state.byNodeId.clear();
    state.selectedAddr = null;
    setStatus('disconnected');
    $('csIdent').textContent = '';
    $('connInfo').textContent = 'Not connected.';
    selectTrain(null);
    renderRoster();
    log('ok', 'disconnected');
});

// -----------------------------------------------------------------------------
// Debug Add Train
// -----------------------------------------------------------------------------

document.querySelectorAll('#addrTypeGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.addrType = c.dataset.addr;
        document.querySelectorAll('#addrTypeGroup .chip').forEach(o => o.classList.toggle('on', o === c));
    });
});

$('btnAddTrain').addEventListener('click', () => {
    const addr = parseInt($('newAddr').value, 10);
    if (!addr || addr < 1 || addr > 10239) { log('err', `invalid DCC address ${addr}`); return; }
    if (state.trains.has(addr)) { log('err', `DCC ${addr} already in roster`); return; }
    const long = state.addrType === 'long' ? true
               : state.addrType === 'short' ? false
               : addr >= 128;
    const steps = parseInt($('newSteps').value, 10);
    const name = $('newName').value.trim() || `DCC ${addr}`;
    allocateTrain({ addr, long, steps, name });
    $('newAddr').value = '';
    $('newName').value = '';
});

// -----------------------------------------------------------------------------
// Selection actions
// -----------------------------------------------------------------------------

$('btnForceEStop').addEventListener('click', () => {
    const e = state.trains.get(state.selectedAddr); if (!e) return;
    e.speedMps = 0;
    touchEntry(e);
    log('ctl', `CS operator forced local EStop on ${e.name}`);
    trackDriver.eStop(e);
    renderRoster();
    // Note: this only drives the mock track; it does not change the train
    // node's set-speed state on the bus.  Any active controller can resume
    // by sending a new Set Speed.
});

$('btnRemove').addEventListener('click', () => {
    const e = state.trains.get(state.selectedAddr); if (!e) return;
    if (!confirm(`Remove ${e.name} (DCC ${e.addr}) from the roster view?\n\nNote: the node remains allocated on the bus until disconnect.`)) return;
    state.trains.delete(e.addr);
    state.byNodeId.delete(e.node.id);
    state.selectedAddr = null;
    log('ok', `removed ${e.name} from UI (node remains on bus)`);
    selectTrain(null);
});

// -----------------------------------------------------------------------------
// Global emergency — originate PCERs from the CS root node
// -----------------------------------------------------------------------------

function sendGlobalEvent(eventId, label) {
    if (!state.csNode) { log('err', `not connected — cannot send ${label}`); return; }
    try {
        state.csNode.sendPcer(eventId);
        log('ctl', `sent PCER ${label}`);
    } catch (e) {
        log('err', `${label} failed: ${e?.message ?? e}`);
    }
}

$('btnEStopAll').addEventListener('click',   () => sendGlobalEvent(Event.EMERGENCY_STOP,       'Emergency Stop All'));
$('btnClearEStop').addEventListener('click', () => sendGlobalEvent(Event.CLEAR_EMERGENCY_STOP, 'Clear Emergency Stop All'));
$('btnEOffAll').addEventListener('click',    () => sendGlobalEvent(Event.EMERGENCY_OFF,        'Emergency Off All'));
$('btnClearEOff').addEventListener('click',  () => sendGlobalEvent(Event.CLEAR_EMERGENCY_OFF,  'Clear Emergency Off All'));

$('btnClearLog').addEventListener('click', () => { $('log').innerHTML = ''; });

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------

setStatus('disconnected');
renderRoster();
log('ok', 'ready — click Connect to attach to JMRI');

// =============================================================================
// OpenLCB Throttle — wired to JMRI via the library's WebSocket transport
// =============================================================================
//
// Flow:
//   * Connect to JMRI → throttle root node logs in.
//   * User enters DCC address + flags, hits Search → throttle sends
//     Identify Producer with a train-search event ID.
//   * Each matching Train Node replies with Producer Identified (valid /
//     invalid / unknown). The library fires onProducerIdentified*, but does
//     not surface the source node ID of the reply.  As a workaround until
//     that gap closes, the throttle reconstructs train node IDs by combining
//     a known CS base (see the "Paired CS" field) with the DCC address
//     encoded in the event ID. THIS ONLY WORKS WITH OUR OWN JS COMMAND
//     STATION. A production throttle needs a library extension to pass the
//     source node ID through.
//   * Selecting a hit sends Assign Controller; on success the throttle drives
//     the train via Set Speed / Set Function / Emergency Stop and responds to
//     heartbeat requests with Noop.
//   * Release on exit and on disconnect (TrainControlS §6.1).

import {
    OpenLcb, WebSocketTransport, PSI, MTI, Event,
    TrainSearchFlag, TrainSearchSpeedSteps, TrainSearchProtocol,
    TransportBusyError,
} from '../../src/index.js';

// -----------------------------------------------------------------------------
// UI helpers
// -----------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const log = (msg) => {
    const t = new Date().toISOString().slice(11, 23);
    const el = $('log');
    el.textContent += `[${t}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
};

function hexDot(big) {
    return big.toString(16).toUpperCase().padStart(12, '0').replace(/(..)(?=..)/g, '$1.');
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const FN_LABELS = [
    'Head', 'Bell', 'Horn', 'Mute', 'Dim',
    'Cplr', 'Brake', 'Notch+', 'Notch-', 'Sand',
    'Rev Light', 'Aux1', 'Aux2', 'Fan', 'Radio',
    'Shovel', 'Compr', 'Injector', 'Spitter', 'Whistle',
    'F20', 'F21', 'F22', 'F23', 'F24',
    'F25', 'F26', 'F27', 'F28',
];

const MPH_PER_MPS = 2.23694;
const MPS_PER_MPH = 0.44704;

const FLOAT16_POSITIVE_ZERO = 0x0000;
const FLOAT16_NEGATIVE_ZERO = 0x8000;

// Heartbeat response deadline (TrainControlTN §2.6.6): default 3s.
const HEARTBEAT_DEADLINE_MS = 2800;

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

const state = {
    screen: 'connect',
    openlcb: null,
    throttleNode: null,

    // Search flags (TrainSearchS §5.2).
    // Allocate defaults on — the common throttle workflow is "find or
    // create a train", and a search without Allocate just times out
    // silently when no train exists yet.
    flags: { exact: false, addr: false, alloc: true },
    trackProto: 'dcc',        // 'any' | 'openlcb' | 'mfx' | 'mm' | 'dcc'
    dccLong: true,
    mmVersion: 'any',         // 'any' | 'v1' | 'v2' | 'v2ext'
    stepMode: 128,

    pendingSearchEvent: null,
    searchHits: new Map(),    // dccAddr -> { addr, long, nodeId, alias, status }
    // Train-search Producer Identified replies arrive with only the source
    // alias on CAN (the wire frame carries no NodeID).  We send a Verify
    // Node ID Addressed and wait for the Verified Node ID reply to learn
    // the 48-bit NodeID before adding the train to the roster.  Keyed by
    // source alias.
    pendingVerify: new Map(), // alias -> { addr, long, eventId, sentAt }

    train: null,              // { addr, long, name, nodeId, alias } once assigned

    direction: 'fwd',
    setStep: 0,
    unit: 'mph',
    topMph: 126,
    functions: new Array(29).fill(0),
    cmdMps: null,
    actMps: null,

    hbRequestDeadline: 0,
    hbTimer: null,
};

// =============================================================================
// Navigation
// =============================================================================

function show(screen) {
    state.screen = screen;
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.toggle('active', s.dataset.screen === screen);
    });
    $('screenTitle').textContent = {
        connect: 'Connect',
        roster: 'Find Train',
        throttle: state.train ? state.train.name : 'Throttle',
    }[screen];
}

function setStatus(name) {
    const p = $('statusPill');
    p.className = `pill ${name}`;
    p.textContent = name;
    $('btnConnect').disabled    = name === 'connected' || name === 'connecting';
    $('btnDisconnect').disabled = name !== 'connected';
    $('btnTopDisconnect').hidden = name !== 'connected' && name !== 'connecting';
}

// =============================================================================
// Connect / disconnect
// =============================================================================

$('btnConnect').addEventListener('click', async () => {
    const url = $('url').value.trim();
    const nodeHex = $('nodeId').value.trim().replace(/[.\s]/g, '');
    if (!url || !nodeHex) return;

    setStatus('connecting');
    log(`connect ${url} as ${hexDot(BigInt('0x' + nodeHex))}`);

    try {
        state.openlcb = await OpenLcb.create({
            transport: new WebSocketTransport({ url }),
            callbacks: {
                onTransportConnect:    () => log('transport connected'),
                onTransportDisconnect: () => { log('transport disconnected'); setStatus('disconnected'); },
                onTransportError:      (err) => log(`transport error: ${err?.message ?? err}`),
                // Throttle-side: a remote train replied to a search we sent.
                // CAN frames don't carry the NodeID, so sourceId is typically 0.
                // We capture the alias, fire Verify Node ID Addressed, and
                // wait for the Verified Node ID reply to learn the NodeID.
                onTrainSearchReply: (sourceId, sourceAlias, eventId) =>
                    handleSearchReply(sourceId, sourceAlias, eventId),
                // Verified Node ID reply — completes a pending search hit by
                // matching on alias, or ignored if alias is not pending.
                onVerifiedNodeId: (_receiver, sourceId, sourceAlias) =>
                    handleVerifiedNodeId(sourceId, sourceAlias),
            },
        });

        state.throttleNode = state.openlcb.createNode(BigInt('0x' + nodeHex), {
            // Throttle is an event sender/receiver, NOT a train.  Do NOT add
            // PSI.TRAIN_CONTROL here — that would auto-setup train_state and
            // falsely announce the throttle as a train on the bus.
            protocolSupport: [PSI.EVENT_EXCHANGE, PSI.SIMPLE_NODE_INFORMATION],
            consumerCountAutocreate: 0,
            producerCountAutocreate: 0,
            snip: {
                mfgVersion: 1,
                name: 'OpenLCB Throttle (JS)',
                model: 'Phone Throttle',
                hardwareVersion: '1.0',
                softwareVersion: '0.1',
                userVersion: 1,
            },
        }, {
            onLoginComplete: (n) => {
                log(`throttle node login complete id=${hexDot(n.id)}`);
                setStatus('connected');
                show('roster');
            },

            // --- Train Control replies from the assigned train --------------
            onTrainControllerAssignReply: (_node, result, _current) => {
                if (!state.train) return;
                if (result === 0) {
                    log(`controller assigned to ${state.train.name}`);
                    enterThrottle();
                } else {
                    const reasons = [];
                    if (result & 0x01) reasons.push('assigned-controller refused');
                    if (result & 0x02) reasons.push('train refused');
                    log(`ASSIGN FAILED (${result}): ${reasons.join(', ') || 'unknown'}`);
                    state.train = null;
                }
            },
            onTrainQuerySpeedsReply: (_node, setSpeed, status, commanded, actual) => {
                if (!state.train) return;
                const f16 = state.openlcb.float16;
                state.cmdMps = f16.isNaN(commanded) ? null : f16.toFloat(commanded);
                state.actMps = f16.isNaN(actual)    ? null : f16.toFloat(actual);
                const dir = f16.getDirection(setSpeed) ? 'rev' : 'fwd';
                state.direction = dir;
                const mps = Math.abs(f16.toFloat(setSpeed));
                state.setStep = mpsToStep(mps);
                $('speed').value = state.setStep;
                updateSpeedReadout();
                log(`query reply: set=${Math.abs(f16.toFloat(setSpeed)).toFixed(2)} m/s ${dir} cmd=${fmtMps(state.cmdMps)} act=${fmtMps(state.actMps)}${status & 0x01 ? ' [ESTOP]' : ''}`);
            },
            onTrainQueryFunctionReply: (_node, fnAddress, fnValue) => {
                if (!state.train) return;
                if (fnAddress >= 0 && fnAddress < state.functions.length) {
                    state.functions[fnAddress] = fnValue ? 1 : 0;
                    renderFunctions();
                }
            },

            // --- Heartbeat (train → throttle) -------------------------------
            onTrainHeartbeatRequest: (_node, timeoutSeconds) => {
                if (!state.train) return;
                state.hbRequestDeadline = Date.now() + HEARTBEAT_DEADLINE_MS;
                $('alerter').className = 'alerter warn';
                log(`heartbeat request (deadline ${timeoutSeconds}s)`);
            },

            onConfigMemRead:  (_n, _a, c, buf) => { buf.fill(0); return c; },
            onConfigMemWrite: (_n, _a, c)       => c,
        });

        await state.openlcb.start();
    } catch (err) {
        log(`connect failed: ${err?.message ?? err}`);
        setStatus('disconnected');
    }
});

$('btnTopDisconnect').addEventListener('click', () => $('btnDisconnect').click());

$('btnDisconnect').addEventListener('click', async () => {
    // Spec §6.1: release controller before intentional shutdown.
    if (state.train && state.train.alias && state.throttleNode) {
        try { state.throttleNode.train.sendReleaseController(state.train.alias, state.train.nodeId); }
        catch (e) { /* already disconnected, etc. */ }
    }
    if (state.openlcb) {
        await state.openlcb.stop();
    }
    state.openlcb = null;
    state.throttleNode = null;
    state.train = null;
    stopHeartbeatWatchdog();
    setStatus('disconnected');
    show('connect');
    log('disconnected');
});

// =============================================================================
// Roster / search
// =============================================================================

document.querySelectorAll('#flagGroup .chip').forEach(c => {
    // Reflect initial state.flags into the chip's visual state.
    const f = c.dataset.flag;
    if (state.flags[f]) c.classList.add('on');
    c.addEventListener('click', () => {
        state.flags[f] = !state.flags[f];
        c.classList.toggle('on', state.flags[f]);
    });
});

function updateProtoVisibility() {
    $('dccOptions').hidden = state.trackProto !== 'dcc';
    $('mmOptions').hidden  = state.trackProto !== 'mm';
}

document.querySelectorAll('#protoGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.trackProto = c.dataset.proto;
        document.querySelectorAll('#protoGroup .chip').forEach(o => o.classList.toggle('on', o === c));
        updateProtoVisibility();
    });
});

document.querySelectorAll('#dccFlagGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        const f = c.dataset.dcc;
        if (f === 'long') {
            state.dccLong = !state.dccLong;
            c.classList.toggle('on', state.dccLong);
        }
    });
});

document.querySelectorAll('#mmGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.mmVersion = c.dataset.mm;
        document.querySelectorAll('#mmGroup .chip').forEach(o => o.classList.toggle('on', o === c));
    });
});

document.querySelectorAll('#stepGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.stepMode = parseInt(c.dataset.step, 10);
        document.querySelectorAll('#stepGroup .chip').forEach(o => o.classList.toggle('on', o === c));
        $('speed').max = state.stepMode;
        updateSpeedReadout();
    });
});

function buildSearchFlags() {
    let f = 0;
    if (state.flags.alloc) f |= TrainSearchFlag.ALLOCATE;
    if (state.flags.exact) f |= TrainSearchFlag.EXACT;
    if (state.flags.addr)  f |= TrainSearchFlag.ADDRESS_ONLY;
    switch (state.trackProto) {
        case 'openlcb':
            f |= TrainSearchProtocol.OPENLCB_NATIVE;
            break;
        case 'mfx':
            f |= TrainSearchProtocol.MFX;
            break;
        case 'mm':
            if      (state.mmVersion === 'v1')    f |= TrainSearchProtocol.MM_V1;
            else if (state.mmVersion === 'v2')    f |= TrainSearchProtocol.MM_V2;
            else if (state.mmVersion === 'v2ext') f |= TrainSearchProtocol.MM_V2_EXTENDED;
            else                                   f |= TrainSearchProtocol.MM_ANY;
            break;
        case 'dcc':
            f |= TrainSearchProtocol.FAMILY_DCC;
            if (state.dccLong) f |= TrainSearchFlag.LONG_ADDR;
            if      (state.stepMode === 14)  f |= TrainSearchSpeedSteps.STEPS_14;
            else if (state.stepMode === 28)  f |= TrainSearchSpeedSteps.STEPS_28;
            else if (state.stepMode === 128) f |= TrainSearchSpeedSteps.STEPS_128;
            break;
        case 'any':
        default:
            break;  // FAMILY_NATIVE / ANY = 0
    }
    return f;
}

$('btnSearch').addEventListener('click', () => {
    if (!state.openlcb || !state.throttleNode) return;
    const q = $('q').value.trim();
    const addr = parseInt(q, 10);
    if (!Number.isFinite(addr) || addr <= 0) { log(`search needs a numeric DCC address (got "${q}")`); return; }

    const flags = buildSearchFlags();
    const eventId = state.openlcb.trainSearch.createEventId(addr, flags);
    state.pendingSearchEvent = eventId;
    state.searchHits.clear();
    renderRoster();

    try {
        state.throttleNode.sendEventWithMti(eventId, MTI.PRODUCER_IDENTIFY);
    } catch (e) {
        log(`search send failed: ${e?.message ?? e}`);
        return;
    }
    log(`search DCC ${addr} flags=0x${flags.toString(16).padStart(2,'0')} event=${eventId.toString(16).toUpperCase()}`);
    $('resultCount').textContent = 'waiting…';

    setTimeout(() => {
        if (state.searchHits.size === 0) {
            $('resultCount').textContent = 'no replies yet';
        }
    }, 400);
});

// Fires only for valid (Set) replies — invalid/unknown replies don't carry
// usable source info and can't be controlled anyway.  See
// protocol_train_search_handler::on_search_reply.
//
// Two-phase resolution because CAN wire frames don't carry the source
// NodeID:
//
//   Phase 1 (here): decode the search event for DCC address + flags,
//   record a pending entry keyed by source alias, and send a Verify Node
//   ID Addressed to that alias.
//
//   Phase 2 (handleVerifiedNodeId): the train replies with Verified Node
//   ID carrying its 48-bit NodeID.  We match on alias, complete the row
//   with the resolved NodeID, and add it to the visible roster.
function handleSearchReply(_sourceId, sourceAlias, eventId) {
    if (!state.openlcb.trainSearch.isSearchEvent(eventId)) return;
    const digits = state.openlcb.trainSearch.extractDigits(eventId);
    const replyFlags = state.openlcb.trainSearch.extractFlags(eventId);
    const addr = state.openlcb.trainSearch.digitsToAddress(digits);
    const isLong = !!(replyFlags & TrainSearchFlag.LONG_ADDR) || addr >= 128;

    state.pendingVerify.set(sourceAlias, {
        addr, long: isLong, eventId, sentAt: Date.now(),
    });
    try {
        state.throttleNode.sendVerifyNodeIdAddressed(sourceAlias);
        log(`search hit DCC ${addr} alias 0x${sourceAlias.toString(16)} — verifying NodeID…`);
    } catch (e) {
        log(`verify send failed: ${e?.message ?? e}`);
        state.pendingVerify.delete(sourceAlias);
    }
}

function handleVerifiedNodeId(sourceId, sourceAlias) {
    const pending = state.pendingVerify.get(sourceAlias);
    if (!pending) return;  // not one of ours
    state.pendingVerify.delete(sourceAlias);

    const hit = {
        addr: pending.addr,
        long: pending.long,
        nodeId: sourceId,
        nodeIdHex: hexDot(sourceId),
        alias: sourceAlias,
        status: 'valid',
    };
    state.searchHits.set(pending.addr, hit);
    log(`verified DCC ${pending.addr} → node ${hit.nodeIdHex} (alias 0x${sourceAlias.toString(16)})`);
    renderRoster();
}

function renderRoster() {
    const el = $('roster');
    el.innerHTML = '';
    const hits = [...state.searchHits.values()].sort((a,b) => a.addr - b.addr);
    $('resultCount').textContent = hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : '—';
    for (const h of hits) {
        const div = document.createElement('div');
        div.className = 'roster-row';
        div.innerHTML = `
            <div class="name">DCC ${h.addr}${h.long ? ' (long)' : ''}</div>
            <div class="addr">${h.status}</div>
            <div class="meta">alias 0x${h.alias.toString(16)}</div>
            <div class="nodeid">${h.nodeIdHex}</div>
        `;
        div.addEventListener('click', () => assignTrain(h));
        el.appendChild(div);
    }
}

// =============================================================================
// Assign / release
// =============================================================================

function assignTrain(h) {
    if (!state.openlcb || !state.throttleNode) return;
    // alias was captured from the search reply itself — no lookup needed.
    state.train = {
        addr: h.addr, long: h.long,
        name: `DCC ${h.addr}`, nodeId: h.nodeId, alias: h.alias,
    };
    log(`requesting Assign Controller → ${h.nodeIdHex} (alias 0x${h.alias.toString(16)})`);
    try {
        state.throttleNode.train.sendAssignController(h.alias, h.nodeId);
    } catch (e) {
        log(`assign send failed: ${e?.message ?? e}`);
        state.train = null;
    }
    // enterThrottle() runs on onTrainControllerAssignReply(result=0).
}

function enterThrottle() {
    state.direction = 'fwd';
    state.setStep = 0;
    state.functions.fill(0);
    state.cmdMps = null;
    state.actMps = null;

    $('trName').textContent = state.train.name;
    $('trSub').textContent = `DCC ${state.train.addr}${state.train.long ? ' (long)' : ''} • ${hexDot(state.train.nodeId)} • alias 0x${state.train.alias.toString(16)}`;
    $('btnFwd').classList.add('on');
    $('btnRev').classList.remove('on');
    $('speed').value = 0;
    $('speed').max = state.stepMode;
    renderFunctions();
    updateSpeedReadout();
    show('throttle');
    startHeartbeatWatchdog();

    // Hydrate state from the train.
    try {
        state.throttleNode.train.sendQuerySpeeds(state.train.alias, state.train.nodeId);
        for (let i = 0; i < 29; i++) {
            state.throttleNode.train.sendQueryFunction(state.train.alias, state.train.nodeId, i);
        }
    } catch (e) {
        log(`hydrate send failed: ${e?.message ?? e}`);
    }
}

$('btnRelease').addEventListener('click', () => {
    if (state.train && state.train.alias) {
        try {
            state.throttleNode.train.sendReleaseController(state.train.alias, state.train.nodeId);
            log(`released ${state.train.name}`);
        } catch (e) {
            log(`release failed: ${e?.message ?? e}`);
        }
    }
    state.train = null;
    stopHeartbeatWatchdog();
    show('roster');
});

// =============================================================================
// Drive: speed / direction / functions / emergency
// =============================================================================

function stepToMps(step, direction) {
    const mph = (step / state.stepMode) * state.topMph;
    const mps = mph * MPS_PER_MPH;
    return direction === 'rev' ? -mps : mps;
}

function mpsToStep(mps) {
    const mph = Math.abs(mps) * MPH_PER_MPS;
    const step = Math.round((mph / state.topMph) * state.stepMode);
    return Math.max(0, Math.min(state.stepMode, step));
}

function fmtMps(v) {
    return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} m/s`;
}

function sendCurrentSpeed() {
    if (!state.train) return;
    const mps = stepToMps(state.setStep, state.direction);
    // float16 spec: signed zero preserves direction even when stopped.
    const f16 = state.openlcb.float16;
    let half;
    if (state.setStep === 0) {
        half = state.direction === 'rev' ? FLOAT16_NEGATIVE_ZERO : FLOAT16_POSITIVE_ZERO;
    } else {
        half = f16.fromFloat(Math.abs(mps));
        if (state.direction === 'rev') half = f16.negate(half);
    }
    try {
        state.throttleNode.train.sendSetSpeed(state.train.alias, state.train.nodeId, half);
    } catch (e) {
        if (e instanceof TransportBusyError) log('setSpeed busy');
        else log(`setSpeed failed: ${e?.message ?? e}`);
    }
    pokeAlerter();
}

function updateSpeedReadout() {
    const step = state.setStep;
    const mph = (step / state.stepMode) * state.topMph;
    const kmh = mph * 1.609344;
    const mps = mph * MPS_PER_MPH;
    let val, unit;
    if (state.unit === 'kmh')      { val = kmh; unit = 'km/h'; }
    else if (state.unit === 'mps') { val = mps; unit = 'm/s'; }
    else                           { val = mph; unit = 'mph'; }

    const sign = state.direction === 'rev' ? '-' : '';
    $('spVal').textContent = `${sign}${val.toFixed(val < 10 ? 1 : 0)}`;
    $('spVal').classList.toggle('rev', state.direction === 'rev');
    $('spUnit').textContent = unit;
    $('spStep').textContent = `step ${step}/${state.stepMode}`;
    $('mSet').textContent = step;
    $('mCmd').textContent = fmtMps(state.cmdMps);
    $('mAct').textContent = fmtMps(state.actMps);
}

function renderFunctions() {
    const g = $('fnGrid');
    g.innerHTML = '';
    for (let i = 0; i < 29; i++) {
        const el = document.createElement('div');
        el.className = 'fn' + (state.functions[i] ? ' on' : '');
        el.innerHTML = `<div class="num">F${i}</div><div class="lbl">${FN_LABELS[i] || ''}</div>`;
        el.addEventListener('click', () => toggleFn(i));
        g.appendChild(el);
    }
}

function toggleFn(i) {
    if (!state.train) return;
    state.functions[i] = state.functions[i] ? 0 : 1;
    renderFunctions();
    try {
        state.throttleNode.train.sendSetFunction(state.train.alias, state.train.nodeId, i, state.functions[i]);
    } catch (e) {
        log(`setFunction failed: ${e?.message ?? e}`);
    }
    pokeAlerter();
}

// Drag-throttle: emit a SetSpeed at most once every SPEED_MIN_INTERVAL_MS
// while the slider is being dragged.  Always send the final value on
// release ('change') so whatever the user landed on is authoritative.
const SPEED_MIN_INTERVAL_MS = 80;
let _lastSpeedSentMs = 0;
let _pendingSpeedTimer = null;

function maybeSendSpeedThrottled() {
    if (!state.train) return;
    const now = Date.now();
    const elapsed = now - _lastSpeedSentMs;
    if (elapsed >= SPEED_MIN_INTERVAL_MS) {
        // Cooldown elapsed — send now.
        _lastSpeedSentMs = now;
        sendCurrentSpeed();
    } else if (_pendingSpeedTimer == null) {
        // In cooldown — schedule a send when it expires.  The handler
        // re-reads state.setStep / state.direction at fire time so we
        // always emit the most recent value, not the value at schedule.
        _pendingSpeedTimer = setTimeout(() => {
            _pendingSpeedTimer = null;
            _lastSpeedSentMs = Date.now();
            sendCurrentSpeed();
        }, SPEED_MIN_INTERVAL_MS - elapsed);
    }
    // else: a send is already queued; it will pick up the latest state
}

$('speed').addEventListener('input', (e) => {
    state.setStep = parseInt(e.target.value, 10);
    updateSpeedReadout();
    maybeSendSpeedThrottled();
});
$('speed').addEventListener('change', () => {
    // User let go — cancel any pending throttled send and emit the final
    // value unconditionally so the settled position is authoritative.
    if (_pendingSpeedTimer) { clearTimeout(_pendingSpeedTimer); _pendingSpeedTimer = null; }
    _lastSpeedSentMs = Date.now();
    sendCurrentSpeed();
});

$('unitSel').addEventListener('change', (e) => { state.unit = e.target.value; updateSpeedReadout(); });

$('btnFwd').addEventListener('click', () => setDir('fwd'));
$('btnRev').addEventListener('click', () => setDir('rev'));

function setDir(d) {
    state.direction = d;
    $('btnFwd').classList.toggle('on', d === 'fwd');
    $('btnRev').classList.toggle('on', d === 'rev');
    updateSpeedReadout();
    sendCurrentSpeed();
}

$('btnEStop').addEventListener('click', () => {
    if (!state.train) return;
    state.setStep = 0;
    $('speed').value = 0;
    updateSpeedReadout();
    try {
        state.throttleNode.train.sendEmergencyStop(state.train.alias, state.train.nodeId);
        log('EMERGENCY STOP (train-local)');
    } catch (e) {
        log(`EStop failed: ${e?.message ?? e}`);
    }
    pokeAlerter();
});

// =============================================================================
// Layout-wide emergency PCERs
// =============================================================================

function sendGlobalEvent(eventId, label) {
    if (!state.throttleNode) return;
    try {
        state.throttleNode.sendPcer(eventId);
        log(`PCER ${label}`);
    } catch (e) {
        log(`${label} failed: ${e?.message ?? e}`);
    }
}

$('btnEStopAll').addEventListener('click',      () => sendGlobalEvent(Event.EMERGENCY_STOP,       'Emergency Stop All'));
$('btnClearEStopAll').addEventListener('click', () => sendGlobalEvent(Event.CLEAR_EMERGENCY_STOP, 'Clear Emergency Stop All'));
$('btnEOffAll').addEventListener('click',       () => sendGlobalEvent(Event.EMERGENCY_OFF,        'Emergency Off All'));
$('btnClearEOffAll').addEventListener('click',  () => sendGlobalEvent(Event.CLEAR_EMERGENCY_OFF,  'Clear Emergency Off All'));

// =============================================================================
// Heartbeat watchdog
// =============================================================================

function startHeartbeatWatchdog() {
    stopHeartbeatWatchdog();
    $('alerter').className = 'alerter ok';
    state.hbTimer = setInterval(() => {
        if (!state.hbRequestDeadline) return;
        const left = state.hbRequestDeadline - Date.now();
        if (left <= 0) {
            log('heartbeat deadline passed — sending Noop');
            sendNoop();
        }
    }, 500);
}
function stopHeartbeatWatchdog() {
    clearInterval(state.hbTimer); state.hbTimer = null;
    state.hbRequestDeadline = 0;
    $('alerter').className = 'alerter';
}
function pokeAlerter() {
    if (state.hbRequestDeadline) {
        state.hbRequestDeadline = 0;
        $('alerter').className = 'alerter ok';
    }
}
function sendNoop() {
    if (!state.train) return;
    try {
        state.throttleNode.train.sendNoop(state.train.alias, state.train.nodeId);
    } catch (e) {
        log(`noop failed: ${e?.message ?? e}`);
    }
    pokeAlerter();
}

// =============================================================================
// Init
// =============================================================================

updateSpeedReadout();
renderFunctions();
log('ready — click Connect to attach to JMRI');

// =============================================================================
// OpenLCB Broadcast Clock Display (Consumer) — exerciser
// =============================================================================
//
// Counterpart to broadcast_clock_source.  This node is a passive listener:
// it sets up as a consumer for a chosen clock, displays the time as it
// arrives, and exposes the consumer-side write paths from spec Section 4.5
// through 4.10 (Set Time/Date/Year/Rate, Command Start/Stop, Query) so an
// operator can drive a remote producer.
//
// Pair this with broadcast_clock_source on the same hub to see Section 6.5
// echo + 3-second sync burst behavior end-to-end.

import {
    OpenLcb, WebSocketTransport,
    BroadcastTimeClock, BroadcastTimeCommand, BroadcastTimeEventType,
} from '../../src/index.js';
import { LocalStorageConfigMemory } from '../../src/storage/localstorage-config-memory.js';
import {
    NODE_ID,
    CONFIG_OFFSETS,
    OpenLcbUserConfig_node_parameters,
} from './openlcb_user_config.js';
import { registerEvents } from './register_events.js';

// -----------------------------------------------------------------------------
// Persistent config memory — keyed by NodeID, sized to match the declared
// 0xFD address space.
// -----------------------------------------------------------------------------
const cfgMem = new LocalStorageConfigMemory({
    size: OpenLcbUserConfig_node_parameters.addressSpaceConfigMemory.highestAddress + 1,
});

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

function hexDot(big, byteCount = 6) {
    const hex = BigInt.asUintN(byteCount * 8, BigInt(big))
        .toString(16).padStart(byteCount * 2, '0').toUpperCase();
    return hex.replace(/(..)(?=..)/g, '$1.');
}

function eventHexDot(eid) {
    return hexDot(BigInt(eid), 8);
}

function show(screen) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.toggle('active', s.dataset.screen === screen);
    });
    $('screenTitle').textContent = screen === 'connect' ? 'Connect' : 'Clock Display';
}

function setStatus(name) {
    const p = $('statusPill');
    p.className = `pill ${name}`;
    p.textContent = name;
    $('btnConnect').disabled    = name === 'connected' || name === 'connecting';
    $('btnDisconnect').disabled = name !== 'connected';
    $('btnTopDisconnect').hidden = name !== 'connected' && name !== 'connecting';
}

// -----------------------------------------------------------------------------
// Config-memory codec
// -----------------------------------------------------------------------------
function readBytes(nodeId, offset, count) {
    const buf = new Uint8Array(count);
    cfgMem.read({ id: nodeId }, offset, count, buf);
    return buf;
}
function readUint(nodeId, offset, count) {
    const b = readBytes(nodeId, offset, count);
    let v = 0;
    for (let i = 0; i < count; i++) v = (v << 8) | b[i];
    return v >>> 0;
}
function readBigUint(nodeId, offset, count) {
    const b = readBytes(nodeId, offset, count);
    let v = 0n;
    for (let i = 0; i < count; i++) v = (v << 8n) | BigInt(b[i]);
    return v;
}

// -----------------------------------------------------------------------------
// Application state
// -----------------------------------------------------------------------------
const WELL_KNOWN = {
    'default-fast':     BroadcastTimeClock.DEFAULT_FAST,
    'default-realtime': BroadcastTimeClock.DEFAULT_REALTIME,
    'alternate-1':      BroadcastTimeClock.ALTERNATE_1,
    'alternate-2':      BroadcastTimeClock.ALTERNATE_2,
};

const state = {
    openlcb: null,
    node: null,

    clockKey: 'default-fast',
    customId: 0x020304050608n,

    isProducer: false,
    isConsumer: false,

    timeFormat: '24',          // '24' | '12'
    autoQuery: true,
    localInterpolation: false,

    // Live state from received events
    live: {
        hour: 0, minute: 0,
        month: 0, day: 0, year: 0,
        rateRaw: 0,
        running: false,
    },

    // Per-event-type "last received" timestamps (Date.now()).  Used to age
    // out the receive-activity table on screen.
    rxTime: {
        time: 0, date: 0, year: 0, rate: 0,
        started: 0, stopped: 0, rollover: 0, changed: 0,
    },
    rxValue: {
        time: '—', date: '—', year: '—', rate: '—',
        started: '—', stopped: '—', rollover: '—', changed: '—',
    },
};

// -----------------------------------------------------------------------------
// Clock-id resolution
// -----------------------------------------------------------------------------
function currentClockId() {
    if (state.clockKey === 'custom') {
        return state.openlcb
            ? state.openlcb.broadcastTime.makeClockId(state.customId)
            : (BigInt.asUintN(48, state.customId) << 16n);
    }
    return WELL_KNOWN[state.clockKey];
}

function refreshClockIdHex() {
    try {
        $('clockIdHex').textContent = hexDot(currentClockId(), 8);
    } catch {
        $('clockIdHex').textContent = '—';
    }
}

// -----------------------------------------------------------------------------
// Connect / disconnect
// -----------------------------------------------------------------------------
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

                onBroadcastTimeChanged: (clockId, h, m) => {
                    if (clockId !== currentClockId()) return;
                    state.live.hour = h; state.live.minute = m;
                    markRx('changed', `${pad2(h)}:${pad2(m)}`);
                    renderReadout();
                },
            },
        });

        state.node = state.openlcb.createNode(BigInt('0x' + nodeHex), OpenLcbUserConfig_node_parameters, {
            onLoginComplete: (n) => {
                log(`display login complete id=${hexDot(n.id)}`);
                setStatus('connected');
                applyBootDefaults(n.id);
                show('clock');
                refreshClockIdHex();
                refreshDiagnostics();
                renderCodec();
                renderReceiveActivity();

                // Auto-setup as consumer at login per spec Section 6.1 — this
                // emits the Consumer Range Identified message that lets the
                // producer start streaming Reports to us.
                try {
                    state.node.broadcastTime.setupConsumer(currentClockId());
                    state.isConsumer = true;
                    log('auto setupConsumer at login');
                } catch (e) { log(`auto setupConsumer failed: ${e?.message ?? e}`); }

                // Optional kick-off behaviors driven by CDI.
                if (state.localInterpolation) {
                    try { state.node.broadcastTime.start(currentClockId()); log('local interpolation start()'); }
                    catch (e) { log(`start failed: ${e?.message ?? e}`); }
                }
                if (state.autoQuery) {
                    try { state.node.broadcastTime.sendQuery(currentClockId()); log('auto sendQuery — expecting Section 6.3 burst'); }
                    catch (e) { log(`auto query failed: ${e?.message ?? e}`); }
                }
                refreshDiagnostics();
            },

            // Per-node broadcast-time callbacks — these are the consumer's
            // bread and butter.  Each one updates the live readout and
            // stamps the Receive Activity table for liveness display.
            onBroadcastTimeReceived: (_n, clockId, hour, minute) => {
                if (clockId !== currentClockId()) return;
                state.live.hour = hour; state.live.minute = minute;
                markRx('time', `${pad2(hour)}:${pad2(minute)}`);
                renderReadout();
                log(`rx Report Time ${pad2(hour)}:${pad2(minute)}`);
            },
            onBroadcastDateReceived: (_n, clockId, month, day) => {
                if (clockId !== currentClockId()) return;
                state.live.month = month; state.live.day = day;
                markRx('date', `${month}/${day}`);
                renderReadout();
                log(`rx Report Date ${month}/${day}`);
            },
            onBroadcastYearReceived: (_n, clockId, year) => {
                if (clockId !== currentClockId()) return;
                state.live.year = year;
                markRx('year', `${year}`);
                renderReadout();
                log(`rx Report Year ${year}`);
            },
            onBroadcastRateReceived: (_n, clockId, rate) => {
                if (clockId !== currentClockId()) return;
                state.live.rateRaw = rate;
                markRx('rate', `raw=${rate} (${rateToFloat(rate).toFixed(2)}x)`);
                renderReadout();
                log(`rx Report Rate raw=${rate}`);
            },
            onBroadcastClockStarted: (_n, clockId) => {
                if (clockId !== currentClockId()) return;
                state.live.running = true;
                markRx('started', '⏵ running');
                renderReadout();
                log('rx Clock Started');
            },
            onBroadcastClockStopped: (_n, clockId) => {
                if (clockId !== currentClockId()) return;
                state.live.running = false;
                markRx('stopped', '⏸ stopped');
                renderReadout();
                log('rx Clock Stopped');
            },
            onBroadcastDateRollover: (_n, clockId) => {
                if (clockId !== currentClockId()) return;
                markRx('rollover', '🔄 midnight');
                log('rx Date Rollover');
            },

            onConfigMemRead:  cfgMem.read.bind(cfgMem),
            onConfigMemWrite: cfgMem.write.bind(cfgMem),

            onUpdateComplete: (n) => log(`config update complete on ${hexDot(n.id)}`),
            onReboot:         (n) => { log(`reset/reboot received for ${hexDot(n.id)}`); softReboot(); },
            onFactoryReset:   (n) => {
                log(`factory reset received for ${hexDot(n.id)} — clearing storage`);
                cfgMem.clear(n.id);
            },
        });

        registerEvents(state.node);

        await state.openlcb.start();
    } catch (err) {
        log(`connect failed: ${err?.message ?? err}`);
        setStatus('disconnected');
    }
});

$('btnTopDisconnect').addEventListener('click', () => $('btnDisconnect').click());

$('btnDisconnect').addEventListener('click', async () => {
    if (state.openlcb) await state.openlcb.stop();
    state.openlcb = null;
    state.node = null;
    state.isProducer = state.isConsumer = false;
    setStatus('disconnected');
    show('connect');
    log('disconnected');
});

async function softReboot() {
    if (!state.openlcb) return;
    state.isProducer = state.isConsumer = false;
    try {
        await state.openlcb.reboot();
    } catch (e) {
        log(`reboot failed: ${e?.message ?? e}`);
        setStatus('disconnected');
        show('connect');
    }
}

// -----------------------------------------------------------------------------
// Boot defaults — pull from cfgMem (CDI-defined offsets) and seed the UI.
// -----------------------------------------------------------------------------
function applyBootDefaults(nodeId) {
    const o = CONFIG_OFFSETS;
    const idIdx     = readUint(nodeId, o.CLOCK_ID_INDEX,    1);
    const customRaw = readBigUint(nodeId, o.CUSTOM_CLOCK_ID, 6);
    const fmt       = readUint(nodeId, o.TIME_FORMAT,       1);
    const autoQ     = readUint(nodeId, o.AUTO_QUERY,        1);
    const interp    = readUint(nodeId, o.LOCAL_INTERPOLATION, 1);

    const KEYS = ['default-fast','default-realtime','alternate-1','alternate-2','custom'];
    state.clockKey = KEYS[idIdx] ?? 'default-fast';
    if (customRaw) state.customId = customRaw;
    state.timeFormat = fmt === 1 ? '12' : '24';
    state.autoQuery  = autoQ !== 0;          // default ON when blank cfgMem
    state.localInterpolation = interp !== 0; // default OFF when blank cfgMem

    $('customId').value = state.customId.toString(16).padStart(12, '0');
    document.querySelectorAll('#clockIdGroup .chip').forEach(c => {
        c.classList.toggle('on', c.dataset.cid === state.clockKey);
    });
    $('customIdRow').hidden = state.clockKey !== 'custom';
    document.querySelectorAll('#formatGroup .chip').forEach(c => {
        c.classList.toggle('on', c.dataset.fmt === state.timeFormat);
    });

    renderReadout();
    renderCodec();
}

// -----------------------------------------------------------------------------
// Identity selector
// -----------------------------------------------------------------------------
document.querySelectorAll('#clockIdGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.clockKey = c.dataset.cid;
        document.querySelectorAll('#clockIdGroup .chip').forEach(o => {
            o.classList.toggle('on', o === c);
        });
        $('customIdRow').hidden = state.clockKey !== 'custom';
        // Switching ID drops the prior role registration.
        state.isProducer = state.isConsumer = false;
        // Clear the rx history — a different clock has a different stream.
        for (const k of Object.keys(state.rxTime))  state.rxTime[k]  = 0;
        for (const k of Object.keys(state.rxValue)) state.rxValue[k] = '—';
        refreshClockIdHex();
        refreshDiagnostics();
        renderCodec();
        renderReceiveActivity();
    });
});

$('customId').addEventListener('input', () => {
    const hex = $('customId').value.replace(/[.\s]/g, '');
    try {
        state.customId = BigInt('0x' + (hex || '0'));
        refreshClockIdHex();
        renderCodec();
    } catch { /* ignore */ }
});

document.querySelectorAll('#formatGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.timeFormat = c.dataset.fmt;
        document.querySelectorAll('#formatGroup .chip').forEach(o => {
            o.classList.toggle('on', o === c);
        });
        renderReadout();
    });
});

// -----------------------------------------------------------------------------
// Setup buttons
// -----------------------------------------------------------------------------
$('btnSetupConsumer').addEventListener('click', () => {
    if (!state.node) return;
    try {
        const cid = currentClockId();
        state.node.broadcastTime.setupConsumer(cid);
        state.isConsumer = true;
        log(`setupConsumer(${hexDot(cid, 8)})`);
        refreshDiagnostics();
    } catch (e) { log(`setupConsumer failed: ${e?.message ?? e}`); }
});

$('btnSetupProducer').addEventListener('click', () => {
    if (!state.node) return;
    try {
        const cid = currentClockId();
        state.node.broadcastTime.setupProducer(cid);
        state.isProducer = true;
        log(`setupProducer(${hexDot(cid, 8)}) — dual role`);
        refreshDiagnostics();
    } catch (e) { log(`setupProducer failed: ${e?.message ?? e}`); }
});

// -----------------------------------------------------------------------------
// Local interpolation (start/stop the library's internal time tracker)
// -----------------------------------------------------------------------------
$('btnLocalStart').addEventListener('click', () => {
    if (!state.node) return;
    state.node.broadcastTime.start(currentClockId());
    log('start() — local interpolation ON');
});
$('btnLocalStop').addEventListener('click', () => {
    if (!state.node) return;
    state.node.broadcastTime.stop(currentClockId());
    log('stop() — local interpolation OFF');
});

// -----------------------------------------------------------------------------
// Outbound consumer commands — Set Time/Date/Year/Rate, Command Start/Stop, Query
// -----------------------------------------------------------------------------
function readStaged() {
    return {
        h:    clamp(+$('setHour').value, 0, 23),
        m:    clamp(+$('setMinute').value, 0, 59),
        mo:   clamp(+$('setMonth').value, 1, 12),
        d:    clamp(+$('setDay').value, 1, 31),
        y:    clamp(+$('setYear').value, 0, 4095),
        rate: clamp(+$('setRateRaw').value, -2048, 2047),
    };
}

function bt() { return state.node?.broadcastTime; }

function withClock(label, fn) {
    if (!state.node) { log('not connected'); return; }
    try { fn(currentClockId()); }
    catch (e) { log(`${label} failed: ${e?.message ?? e}`); }
}

$('btnSetTime').addEventListener('click', () => withClock('sendSetTime', (c) => { const s = readStaged(); bt().sendSetTime(c, s.h, s.m); log(`tx Set Time ${pad2(s.h)}:${pad2(s.m)}`); }));
$('btnSetDate').addEventListener('click', () => withClock('sendSetDate', (c) => { const s = readStaged(); bt().sendSetDate(c, s.mo, s.d); log(`tx Set Date ${s.mo}/${s.d}`); }));
$('btnSetYear').addEventListener('click', () => withClock('sendSetYear', (c) => { const s = readStaged(); bt().sendSetYear(c, s.y); log(`tx Set Year ${s.y}`); }));
$('btnSetRate').addEventListener('click', () => withClock('sendSetRate', (c) => { const s = readStaged(); bt().sendSetRate(c, s.rate); log(`tx Set Rate raw=${s.rate} (${rateToFloat(s.rate).toFixed(2)}x)`); }));
$('btnCmdStart').addEventListener('click', () => withClock('sendCommandStart', (c) => { bt().sendCommandStart(c); log('tx Command Start'); }));
$('btnCmdStop').addEventListener('click',  () => withClock('sendCommandStop',  (c) => { bt().sendCommandStop(c);  log('tx Command Stop'); }));
$('btnSendQuery').addEventListener('click', () => withClock('sendQuery',       (c) => { bt().sendQuery(c);        log('tx Query — expecting Section 6.3 burst'); }));

// -----------------------------------------------------------------------------
// Live readout
// -----------------------------------------------------------------------------
function pad2(n) { return n.toString().padStart(2, '0'); }
function rateToFloat(raw) { return raw / 4; }

function renderReadout() {
    let h = state.live.hour;
    let displayHour, ampm;
    if (state.timeFormat === '12') {
        ampm = h >= 12 ? 'PM' : 'AM';
        displayHour = h % 12 || 12;
        $('readAmPm').textContent = ampm;
        $('readAmPm').hidden = false;
    } else {
        displayHour = h;
        $('readAmPm').hidden = true;
    }
    $('readTime').textContent = `${pad2(displayHour)}:${pad2(state.live.minute)}`;

    const monthName = ['—','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][state.live.month] ?? '—';
    $('readDate').textContent = state.live.month ? `${monthName} ${state.live.day}` : '—';
    $('readYear').textContent = state.live.year ? `${state.live.year}` : '—';
    const r = rateToFloat(state.live.rateRaw);
    $('readRate').textContent = `${r >= 0 ? '+' : ''}${r.toFixed(2)}x`;

    const pill = $('runPill');
    pill.className  = `pill ${state.live.running ? 'running' : 'stopped'}`;
    pill.textContent = state.live.running ? 'Running' : 'Stopped';
}

// -----------------------------------------------------------------------------
// Receive activity table — per-row "last value" + age
// -----------------------------------------------------------------------------
function markRx(kind, value) {
    state.rxTime[kind]  = Date.now();
    state.rxValue[kind] = value;
    renderReceiveActivity();
    updateFreshness();
}

function renderReceiveActivity() {
    const now = Date.now();
    document.querySelectorAll('.rx-row').forEach(row => {
        const k = row.dataset.evt;
        const ts = state.rxTime[k];
        row.querySelector('[data-field="val"]').textContent = state.rxValue[k];
        if (!ts) {
            row.querySelector('[data-field="age"]').textContent = '—';
            row.classList.remove('fresh', 'stale');
            return;
        }
        const ageMs = now - ts;
        row.querySelector('[data-field="age"]').textContent = formatAge(ageMs);
        row.classList.toggle('fresh', ageMs <  3000);
        row.classList.toggle('stale', ageMs >= 90000);
    });
}

function updateFreshness() {
    const tsAny = Math.max(...Object.values(state.rxTime));
    if (!tsAny) {
        $('freshness').textContent = 'no events received yet';
        return;
    }
    const ageMs = Date.now() - tsAny;
    $('freshness').textContent = `last event ${formatAge(ageMs)} ago`;
}

function formatAge(ms) {
    if (ms < 1000)  return `${ms} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)} min`;
    return `${Math.floor(ms / 3600000)} hr`;
}

// 1 Hz refresh of the age column so stale events visibly drift.
setInterval(() => { renderReceiveActivity(); updateFreshness(); }, 1000);

// -----------------------------------------------------------------------------
// Codec preview + decode
// -----------------------------------------------------------------------------
function renderCodec() {
    const olcb = state.openlcb;
    if (!olcb) return;
    const c = currentClockId();
    const s = readStaged();
    const bc = olcb.broadcastTime;

    const set = (id, v) => { $(id).textContent = eventHexDot(v); };
    try {
        set('builtTimeReport', bc.createTimeEventId(c, s.h, s.m, false));
        set('builtTimeSet',    bc.createTimeEventId(c, s.h, s.m, true));
        set('builtDateReport', bc.createDateEventId(c, s.mo, s.d, false));
        set('builtDateSet',    bc.createDateEventId(c, s.mo, s.d, true));
        set('builtYearReport', bc.createYearEventId(c, s.y, false));
        set('builtYearSet',    bc.createYearEventId(c, s.y, true));
        set('builtRateReport', bc.createRateEventId(c, s.rate, false));
        set('builtRateSet',    bc.createRateEventId(c, s.rate, true));
        set('builtCmdQuery',   bc.createCommandEventId(c, BroadcastTimeCommand.QUERY));
        $('builtCmdStartStop').textContent =
            'Start ' + eventHexDot(bc.createCommandEventId(c, BroadcastTimeCommand.START)) +
            '\nStop  ' + eventHexDot(bc.createCommandEventId(c, BroadcastTimeCommand.STOP));
    } catch { /* ignore garbage */ }

    const r = rateToFloat(s.rate);
    $('rateEffective').textContent = `${r >= 0 ? '+' : ''}${r.toFixed(2)}x`;
}

['setHour','setMinute','setMonth','setDay','setYear','setRateRaw'].forEach(id => {
    $(id).addEventListener('input', renderCodec);
});

const TYPE_NAMES = {
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_REPORT_TIME]:  'Report Time',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_REPORT_DATE]:  'Report Date',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_REPORT_YEAR]:  'Report Year',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_REPORT_RATE]:  'Report Rate',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_SET_TIME]:     'Set Time',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_SET_DATE]:     'Set Date',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_SET_YEAR]:     'Set Year',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_SET_RATE]:     'Set Rate',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_QUERY]:        'Query',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_STOP]:         'Stop',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_START]:        'Start',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_DATE_ROLLOVER]:'Date Rollover',
    [BroadcastTimeEventType.BROADCAST_TIME_EVENT_UNKNOWN]:      'Unknown',
};

$('decodeIn').addEventListener('input', () => {
    const olcb = state.openlcb;
    if (!olcb) { $('decodeOut').textContent = 'connect first'; return; }
    const raw = $('decodeIn').value.replace(/[.\s]/g, '');
    if (!raw) { $('decodeOut').textContent = '—'; return; }
    let eid;
    try { eid = BigInt('0x' + raw); }
    catch { $('decodeOut').textContent = 'not a valid hex value'; return; }

    const bc = olcb.broadcastTime;
    if (!bc.isTimeEvent(eid)) {
        $('decodeOut').textContent =
            `${eventHexDot(eid)}\nisTimeEvent: false (not a broadcast-time event)`;
        return;
    }
    const cid = bc.extractClockId(eid);
    const t = bc.getEventType(eid);
    const lines = [
        `event:    ${eventHexDot(eid)}`,
        `clock id: ${hexDot(cid, 8)}`,
        `type:     ${t}  (${TYPE_NAMES[t] ?? '?'})`,
    ];
    const time = bc.extractTime(eid); if (time) lines.push(`time:     ${pad2(time.hour)}:${pad2(time.minute)}`);
    const date = bc.extractDate(eid); if (date) lines.push(`date:     ${date.month}/${date.day}`);
    const year = bc.extractYear(eid); if (year != null) lines.push(`year:     ${year}`);
    const rate = bc.extractRate(eid); if (rate != null) lines.push(`rate raw: ${rate}  (${rateToFloat(rate).toFixed(2)}x)`);
    $('decodeOut').textContent = lines.join('\n');
});

// -----------------------------------------------------------------------------
// Diagnostics
// -----------------------------------------------------------------------------
function refreshDiagnostics() {
    if (!state.node) {
        $('diagIsConsumer').textContent = '—';
        $('diagIsProducer').textContent = '—';
        $('identityStatus').textContent = '—';
        return;
    }
    const cid = currentClockId();
    const isC = state.node.broadcastTime.isConsumer(cid);
    const isP = state.node.broadcastTime.isProducer(cid);
    state.isConsumer = isC;
    state.isProducer = isP;
    $('diagIsConsumer').textContent = isC ? 'yes' : 'no';
    $('diagIsProducer').textContent = isP ? 'yes' : 'no';
    const roles = [];
    if (isC) roles.push('consumer');
    if (isP) roles.push('producer');
    $('identityStatus').textContent = roles.length ? roles.join(' + ') : 'not set up';
}

$('btnRefreshDiag').addEventListener('click', refreshDiagnostics);

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo)); }

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------
$('nodeId').value = NODE_ID.toString(16).padStart(12, '0');
renderReadout();
renderReceiveActivity();
log('ready — click Connect to attach to JMRI');

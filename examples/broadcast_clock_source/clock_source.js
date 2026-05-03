// =============================================================================
// OpenLCB Broadcast Clock Generator — exerciser
// =============================================================================
//
// Exercises every WASM export tied to the BroadcastTimeS standard
// (Apr 25, 2021).  Mirrors the throttle example for transport setup, node
// parameters and config-memory persistence; the body of the page is
// purpose-built around the broadcast-time API surface.
//
// The library handles spec Section 6.1 (Range Identified at startup),
// Section 6.2 (per-minute Report Time stream while running, plus Date Rollover
// + 3s lag), Section 6.3 (sync-burst sequence), Section 6.4 (Query reply) and
// Section 6.5 (Set echo + 3s burst) automatically when `setupProducer` is
// called — this exerciser provides explicit triggers for the same paths so you
// can verify each branch on the wire.

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
    $('screenTitle').textContent = screen === 'connect' ? 'Connect' : 'Broadcast Clock';
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
// Config-memory codec — maps the CONFIG_OFFSETS layout to JS values.
// LocalStorageConfigMemory's `read` is the on-the-wire callback; reuse it
// for in-process reads by passing a tiny buffer and an {id} shim.
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
function readInt(nodeId, offset, count) {
    let v = readUint(nodeId, offset, count);
    const bits = count * 8;
    const sign = 1 << (bits - 1);
    return (v & sign) ? v - (1 << bits) : v;
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

    // Clock identity
    clockKey: 'default-fast', // 'default-fast' | 'default-realtime' | 'alternate-1' | 'alternate-2' | 'custom'
    customId: 0x020304050608n,

    // Roles for the currently-selected clock id
    isProducer: false,
    isConsumer: false,

    // Live state shown in the readout — updated by callbacks
    live: {
        hour:    6,
        minute:  0,
        month:   10,
        day:     3,
        year:    1953,
        rateRaw: 4,    // 1.00x
        running: false,
    },
};

// -----------------------------------------------------------------------------
// Clock-id resolution
// -----------------------------------------------------------------------------
function currentClockId() {
    if (state.clockKey === 'custom') {
        // Custom upper-6-byte ID, formed via the WASM helper so the lower
        // two bytes are guaranteed zero (the "Specific Upper Part" + 16-bit
        // event variant per spec Section 4).
        return state.openlcb
            ? state.openlcb.broadcastTime.makeClockId(state.customId)
            : (BigInt.asUintN(48, state.customId) << 16n);
    }
    return WELL_KNOWN[state.clockKey];
}

function refreshClockIdHex() {
    try {
        $('clockIdHex').textContent = hexDot(currentClockId(), 8);
    } catch (e) {
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

                // Runtime-level minute tick — fires for every clock the library
                // tracks, including this producer's own.  Use it to drive the
                // big readout cheaply, and only update Time fields.
                onBroadcastTimeChanged: (clockId, h, m) => {
                    if (clockId !== currentClockId()) return;
                    state.live.hour = h; state.live.minute = m;
                    renderReadout();
                },
            },
        });

        state.node = state.openlcb.createNode(BigInt('0x' + nodeHex), OpenLcbUserConfig_node_parameters, {
            onLoginComplete: (n) => {
                log(`generator login complete id=${hexDot(n.id)}`);
                setStatus('connected');
                applyBootDefaults(n.id);
                show('clock');
                refreshClockIdHex();
                refreshDiagnostics();
                renderCodec();
            },

            // Per-node broadcast-time callbacks — fire whenever a recognized
            // event arrives on the bus for any clock this node has set up.
            onBroadcastTimeReceived: (_node, clockId, hour, minute) => {
                if (clockId !== currentClockId()) return;
                state.live.hour = hour; state.live.minute = minute;
                renderReadout();
                log(`rx Report Time ${pad2(hour)}:${pad2(minute)}`);
            },
            onBroadcastDateReceived: (_node, clockId, month, day) => {
                if (clockId !== currentClockId()) return;
                state.live.month = month; state.live.day = day;
                renderReadout();
                log(`rx Report Date ${month}/${day}`);
            },
            onBroadcastYearReceived: (_node, clockId, year) => {
                if (clockId !== currentClockId()) return;
                state.live.year = year;
                renderReadout();
                log(`rx Report Year ${year}`);
            },
            onBroadcastRateReceived: (_node, clockId, rate) => {
                if (clockId !== currentClockId()) return;
                state.live.rateRaw = rate;
                renderReadout();
                log(`rx Report Rate raw=${rate} (${rateToFloat(rate).toFixed(2)}x)`);
            },
            onBroadcastClockStarted: (_node, clockId) => {
                if (clockId !== currentClockId()) return;
                state.live.running = true;
                renderReadout();
                log('rx Clock Started');
            },
            onBroadcastClockStopped: (_node, clockId) => {
                if (clockId !== currentClockId()) return;
                state.live.running = false;
                renderReadout();
                log('rx Clock Stopped');
            },
            onBroadcastDateRollover: (_node, clockId) => {
                if (clockId !== currentClockId()) return;
                log('rx Date Rollover');
            },

            // Config Memory persistence (same pattern as the throttle).
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
// On a fresh / blank cfgMem these read as zero, which gives an ill-formed
// clock (00:00, 0/0, year 0, rate 0).  Detect that and fall back to a
// sensible default rather than ship a date a consumer would reject.
// -----------------------------------------------------------------------------
function applyBootDefaults(nodeId) {
    const o = CONFIG_OFFSETS;
    const idIdx     = readUint(nodeId, o.CLOCK_ID_INDEX,    1);
    const customRaw = readBigUint(nodeId, o.CUSTOM_CLOCK_ID, 6);
    const auto      = readUint(nodeId, o.AUTO_START,        1);
    let h    = readUint(nodeId, o.INITIAL_HOUR,    1);
    let m    = readUint(nodeId, o.INITIAL_MINUTE,  1);
    let mo   = readUint(nodeId, o.INITIAL_MONTH,   1);
    let d    = readUint(nodeId, o.INITIAL_DAY,     1);
    let y    = readUint(nodeId, o.INITIAL_YEAR,    2);
    let rate = readInt(nodeId, o.INITIAL_RATE_RAW, 2);

    // Fallback when month/day are out of range (i.e. cfgMem still zeroed).
    if (mo < 1 || mo > 12 || d < 1 || d > 31) {
        h = 6; m = 0; mo = 10; d = 3; y = 1953; rate = 4;
        log('cfgMem appears empty — seeding defaults 06:00 Oct 3 1953 1.00x');
    }

    const KEYS = ['default-fast','default-realtime','alternate-1','alternate-2','custom'];
    state.clockKey = KEYS[idIdx] ?? 'default-fast';
    if (customRaw) state.customId = customRaw;

    state.live = {
        hour: h, minute: m, month: mo, day: d, year: y,
        rateRaw: rate,
        running: !!auto,
    };

    // Sync the staging inputs to the booted state for first paint.
    $('repHour').value     = h;
    $('repMinute').value   = m;
    $('repMonth').value    = mo;
    $('repDay').value      = d;
    $('repYear').value     = y;
    $('repRateRaw').value  = rate;
    $('customId').value    = state.customId.toString(16).padStart(12, '0');

    document.querySelectorAll('#clockIdGroup .chip').forEach(c => {
        c.classList.toggle('on', c.dataset.cid === state.clockKey);
    });
    $('customIdRow').hidden = state.clockKey !== 'custom';

    renderReadout();
    renderCodec();
}

// -----------------------------------------------------------------------------
// Identity selector — chip group + custom id input
// -----------------------------------------------------------------------------
document.querySelectorAll('#clockIdGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.clockKey = c.dataset.cid;
        document.querySelectorAll('#clockIdGroup .chip').forEach(o => {
            o.classList.toggle('on', o === c);
        });
        $('customIdRow').hidden = state.clockKey !== 'custom';
        // Clear roles — the new ID hasn't been set up yet on either side.
        state.isProducer = state.isConsumer = false;
        refreshClockIdHex();
        refreshDiagnostics();
        renderCodec();
    });
});

$('customId').addEventListener('input', () => {
    const hex = $('customId').value.replace(/[.\s]/g, '');
    try {
        state.customId = BigInt('0x' + (hex || '0'));
        refreshClockIdHex();
        renderCodec();
    } catch { /* ignore mid-typed garbage */ }
});

// -----------------------------------------------------------------------------
// Setup as Producer / Consumer
// -----------------------------------------------------------------------------
$('btnSetupProducer').addEventListener('click', () => {
    if (!state.node) return;
    try {
        const cid = currentClockId();
        state.node.broadcastTime.setupProducer(cid);
        state.isProducer = true;
        log(`setupProducer(${hexDot(cid, 8)})`);
        refreshDiagnostics();
        // Section 6.5 says startup also runs the 6.3 sync sequence.  The
        // library does this for us, but expose the trigger explicitly.
    } catch (e) {
        log(`setupProducer failed: ${e?.message ?? e}`);
    }
});

$('btnSetupConsumer').addEventListener('click', () => {
    if (!state.node) return;
    try {
        const cid = currentClockId();
        state.node.broadcastTime.setupConsumer(cid);
        state.isConsumer = true;
        log(`setupConsumer(${hexDot(cid, 8)})`);
        refreshDiagnostics();
    } catch (e) {
        log(`setupConsumer failed: ${e?.message ?? e}`);
    }
});

// -----------------------------------------------------------------------------
// Local clock advance (start/stop the library's internal time tracker)
// -----------------------------------------------------------------------------
$('btnLocalStart').addEventListener('click', () => {
    if (!state.node) return;
    state.node.broadcastTime.start(currentClockId());
    log('start() — local advance ON');
});
$('btnLocalStop').addEventListener('click', () => {
    if (!state.node) return;
    state.node.broadcastTime.stop(currentClockId());
    log('stop() — local advance OFF');
});

// -----------------------------------------------------------------------------
// Producer reports — emit each event type on the wire from the staged values
// -----------------------------------------------------------------------------
function readStaged() {
    return {
        h:    clamp(+$('repHour').value, 0, 23),
        m:    clamp(+$('repMinute').value, 0, 59),
        mo:   clamp(+$('repMonth').value, 1, 12),
        d:    clamp(+$('repDay').value, 1, 31),
        y:    clamp(+$('repYear').value, 0, 4095),
        rate: clamp(+$('repRateRaw').value, -2048, 2047),
    };
}

function bt() { return state.node?.broadcastTime; }

function withClock(label, fn) {
    if (!state.node) { log('not connected'); return; }
    try { fn(currentClockId()); }
    catch (e) { log(`${label} failed: ${e?.message ?? e}`); }
}

$('btnReportTime').addEventListener('click',   () => withClock('sendReportTime',   (c) => { const s = readStaged(); bt().sendReportTime(c, s.h, s.m); log(`tx Report Time ${pad2(s.h)}:${pad2(s.m)}`); }));
$('btnReportDate').addEventListener('click',   () => withClock('sendReportDate',   (c) => { const s = readStaged(); bt().sendReportDate(c, s.mo, s.d); log(`tx Report Date ${s.mo}/${s.d}`); }));
$('btnReportYear').addEventListener('click',   () => withClock('sendReportYear',   (c) => { const s = readStaged(); bt().sendReportYear(c, s.y); log(`tx Report Year ${s.y}`); }));
$('btnReportRate').addEventListener('click',   () => withClock('sendReportRate',   (c) => { const s = readStaged(); bt().sendReportRate(c, s.rate); log(`tx Report Rate raw=${s.rate} (${rateToFloat(s.rate).toFixed(2)}x)`); }));
$('btnReportStart').addEventListener('click',  () => withClock('sendStart',        (c) => { bt().sendStart(c); log('tx Report Start'); }));
$('btnReportStop').addEventListener('click',   () => withClock('sendStop',         (c) => { bt().sendStop(c); log('tx Report Stop'); }));
$('btnDateRollover').addEventListener('click', () => withClock('sendDateRollover', (c) => { bt().sendDateRollover(c); log('tx Date Rollover'); }));
$('btnQueryReply').addEventListener('click',   () => withClock('sendQueryReply',   (c) => { bt().sendQueryReply(c); log('tx Query Reply (single)'); }));

$('btnTriggerQueryReply').addEventListener('click', () => withClock('triggerQueryReply', (c) => {
    bt().triggerQueryReply(c);
    log('triggerQueryReply — Section 6.3 burst queued');
}));
$('btnTriggerSyncDelay').addEventListener('click', () => withClock('triggerSyncDelay', (c) => {
    bt().triggerSyncDelay(c);
    log('triggerSyncDelay — burst scheduled in 3s (Section 6.5)');
}));

// -----------------------------------------------------------------------------
// Outbound Set commands (consumer-style; producer here echoes them back)
// -----------------------------------------------------------------------------
$('btnSetTime').addEventListener('click', () => withClock('sendSetTime', (c) => { const s = readStaged(); bt().sendSetTime(c, s.h, s.m); log(`tx Set Time ${pad2(s.h)}:${pad2(s.m)}`); }));
$('btnSetDate').addEventListener('click', () => withClock('sendSetDate', (c) => { const s = readStaged(); bt().sendSetDate(c, s.mo, s.d); log(`tx Set Date ${s.mo}/${s.d}`); }));
$('btnSetYear').addEventListener('click', () => withClock('sendSetYear', (c) => { const s = readStaged(); bt().sendSetYear(c, s.y); log(`tx Set Year ${s.y}`); }));
$('btnSetRate').addEventListener('click', () => withClock('sendSetRate', (c) => { const s = readStaged(); bt().sendSetRate(c, s.rate); log(`tx Set Rate raw=${s.rate} (${rateToFloat(s.rate).toFixed(2)}x)`); }));
$('btnCmdStart').addEventListener('click', () => withClock('sendCommandStart', (c) => { bt().sendCommandStart(c); log('tx Command Start'); }));
$('btnCmdStop').addEventListener('click',  () => withClock('sendCommandStop',  (c) => { bt().sendCommandStop(c);  log('tx Command Stop'); }));
$('btnSendQuery').addEventListener('click', () => withClock('sendQuery', (c) => { bt().sendQuery(c); log('tx Query'); }));

// -----------------------------------------------------------------------------
// Live readout
// -----------------------------------------------------------------------------
function pad2(n) { return n.toString().padStart(2, '0'); }

function rateToFloat(raw) { return raw / 4; }

function renderReadout() {
    $('readTime').textContent = `${pad2(state.live.hour)}:${pad2(state.live.minute)}`;
    const monthName = ['—','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][state.live.month] ?? '—';
    $('readDate').textContent = `${monthName} ${state.live.day}`;
    $('readYear').textContent = `${state.live.year}`;
    const r = rateToFloat(state.live.rateRaw);
    $('readRate').textContent = `${r >= 0 ? '+' : ''}${r.toFixed(2)}x`;
    const pill = $('runPill');
    pill.className  = `pill ${state.live.running ? 'running' : 'stopped'}`;
    pill.textContent = state.live.running ? 'Running' : 'Stopped';
}

// -----------------------------------------------------------------------------
// Codec preview — built event IDs + decode panel
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
        set('builtCmdQuery',     bc.createCommandEventId(c, BroadcastTimeCommand.QUERY));
        $('builtCmdStartStop').textContent =
            'Start ' + eventHexDot(bc.createCommandEventId(c, BroadcastTimeCommand.START)) +
            '\nStop  ' + eventHexDot(bc.createCommandEventId(c, BroadcastTimeCommand.STOP));
    } catch (e) {
        // BigInt range issues on garbage input — fall back to dashes.
    }

    const r = rateToFloat(s.rate);
    $('rateEffective').textContent = `${r >= 0 ? '+' : ''}${r.toFixed(2)}x`;
}

['repHour','repMinute','repMonth','repDay','repYear','repRateRaw'].forEach(id => {
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
    const isTime = bc.isTimeEvent(eid);
    if (!isTime) {
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
        $('diagIsProducer').textContent = '—';
        $('diagIsConsumer').textContent = '—';
        $('identityStatus').textContent = '—';
        return;
    }
    const cid = currentClockId();
    const isP = state.node.broadcastTime.isProducer(cid);
    const isC = state.node.broadcastTime.isConsumer(cid);
    state.isProducer = isP;
    state.isConsumer = isC;
    $('diagIsProducer').textContent = isP ? 'yes' : 'no';
    $('diagIsConsumer').textContent = isC ? 'yes' : 'no';
    const roles = [];
    if (isP) roles.push('producer');
    if (isC) roles.push('consumer');
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
log('ready — click Connect to attach to JMRI');

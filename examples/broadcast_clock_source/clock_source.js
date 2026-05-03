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
    BroadcastTimeClock, BroadcastTimeEventType,
} from '../../src/index.js';
import { LocalStorageConfigMemory } from '../../src/storage/localstorage-config-memory.js';
import {
    NODE_ID,
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
    $('screenTitle').textContent = screen === 'connect' ? 'Connect' : 'Generator';
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
// Application state
// -----------------------------------------------------------------------------
// Catalog of selectable well-known clocks.  Each entry maps a stable JS key
// to the spec's 64-bit Specific Upper Part and a checkbox id on the Connect
// screen.  Custom clocks are not in this list — they're handled separately
// via the `ckCustom` checkbox + `customId` text field.
const WELL_KNOWN_CLOCKS = [
    { key: 'default-fast',     ck: 'ckDefaultFast',     id: BroadcastTimeClock.DEFAULT_FAST,     label: 'Default Fast' },
    { key: 'default-realtime', ck: 'ckDefaultRealtime', id: BroadcastTimeClock.DEFAULT_REALTIME, label: 'Default Real-time' },
    { key: 'alternate-1',      ck: 'ckAlternate1',      id: BroadcastTimeClock.ALTERNATE_1,      label: 'Alternate 1' },
    { key: 'alternate-2',      ck: 'ckAlternate2',      id: BroadcastTimeClock.ALTERNATE_2,      label: 'Alternate 2' },
];

const state = {
    openlcb: null,
    node: null,

    // Populated at Connect time from the user's checkbox selections.
    // Each entry: { key, clockId (BigInt), label }.
    activeClocks: [],

    // Which clock the on-screen control panels currently target.
    focusedKey: null,

    // Per-clock live state, keyed by clockKey.  Callbacks update the matching
    // clock; renderReadout reads the focused clock's slot.
    // Shape: { [key]: { hour, minute, month, day, year, rateRaw, running } }
    live: {},
};

// -----------------------------------------------------------------------------
// Clock-id resolution
// -----------------------------------------------------------------------------
function currentClockId() {
    return state.activeClocks.find(c => c.key === state.focusedKey)?.clockId ?? null;
}

function keyForClockId(clockId) {
    return state.activeClocks.find(c => c.clockId === clockId)?.key ?? null;
}

// Populate the focus chip group from state.activeClocks.  Called once at login
// complete; the chips persist for the session.
function populateClockChips() {
    const group = $('clockIdGroup');
    group.innerHTML = '';
    for (const c of state.activeClocks) {
        const chip = document.createElement('span');
        chip.className = 'chip' + (c.key === state.focusedKey ? ' on' : '');
        chip.dataset.cid = c.key;
        chip.textContent = c.label;
        chip.addEventListener('click', () => {
            state.focusedKey = c.key;
            document.querySelectorAll('#clockIdGroup .chip').forEach(o => o.classList.toggle('on', o === chip));
            refreshIdentityStatus();
            renderReadout();
            renderCodec();
        });
        group.appendChild(chip);
    }
}

// -----------------------------------------------------------------------------
// Connect / disconnect
// -----------------------------------------------------------------------------
$('btnConnect').addEventListener('click', async () => {
    const url = $('url').value.trim();
    const nodeHex = $('nodeId').value.trim().replace(/[.\s]/g, '');
    if (!url || !nodeHex) return;

    // Defensive — the button is also gated by refreshConnectGate(), but
    // re-check in case both got out of sync somehow.
    const anyClock = WELL_KNOWN_CLOCKS.some(wk => $(wk.ck).checked) || $('ckCustom').checked;
    if (!anyClock) {
        log('cannot connect: tick at least one clock first');
        return;
    }

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
                // tracks.  Update the matching clock's slot; only re-render if
                // it's the focused one.
                onBroadcastTimeChanged: (clockId, h, m) => {
                    const key = keyForClockId(clockId);
                    if (!key) return;
                    state.live[key].hour = h;
                    state.live[key].minute = m;
                    if (key === state.focusedKey) renderReadout();
                },
            },
        });

        state.node = state.openlcb.createNode(BigInt('0x' + nodeHex), OpenLcbUserConfig_node_parameters, {
            onLoginComplete: (n) => {
                log(`logged in as ${hexDot(n.id)}`);
                setStatus('connected');
                show('clock');
                populateClockChips();
                refreshIdentityStatus();
                renderReadout();
                renderCodec();
            },

            // Time updates that come back from the network — keeps each
            // clock's slot in sync with what's actually on the wire.
            onBroadcastTimeReceived: (_node, clockId, hour, minute) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].hour = hour; state.live[key].minute = minute;
                if (key === state.focusedKey) renderReadout();
                log(`heard time ${pad2(hour)}:${pad2(minute)} on "${labelFor(key)}"`);
            },
            onBroadcastDateReceived: (_node, clockId, month, day) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].month = month; state.live[key].day = day;
                if (key === state.focusedKey) renderReadout();
                log(`heard date ${month}/${day} on "${labelFor(key)}"`);
            },
            onBroadcastYearReceived: (_node, clockId, year) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].year = year;
                if (key === state.focusedKey) renderReadout();
                log(`heard year ${year} on "${labelFor(key)}"`);
            },
            onBroadcastRateReceived: (_node, clockId, rate) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].rateRaw = rate;
                if (key === state.focusedKey) renderReadout();
                log(`heard speed ${rateToFloat(rate).toFixed(2)}x on "${labelFor(key)}"`);
            },
            onBroadcastClockStarted: (_node, clockId) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].running = true;
                if (key === state.focusedKey) renderReadout();
                log(`"${labelFor(key)}" started`);
            },
            onBroadcastClockStopped: (_node, clockId) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].running = false;
                if (key === state.focusedKey) renderReadout();
                log(`"${labelFor(key)}" stopped`);
            },
            onBroadcastDateRollover: (_node, clockId) => {
                const key = keyForClockId(clockId); if (!key) return;
                log(`"${labelFor(key)}" crossed midnight`);
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

        // Build the active-clocks list from the Connect-screen checkboxes.
        // This drives both the §6.1 Range Identified emissions (registered
        // before login via setupProducer) and the runtime focus chip group.
        state.activeClocks = [];
        for (const wk of WELL_KNOWN_CLOCKS) {
            if ($(wk.ck).checked) {
                state.activeClocks.push({ key: wk.key, clockId: wk.id, label: wk.label });
            }
        }
        if ($('ckCustom').checked) {
            const hex = $('customId').value.replace(/[.\s]/g, '');
            const customRaw = BigInt('0x' + (hex || '0'));
            const cid = state.openlcb.broadcastTime.makeClockId(customRaw);
            state.activeClocks.push({
                key: 'custom',
                clockId: cid,
                label: 'Custom ' + hexDot(customRaw, 6),
            });
        }
        state.focusedKey = state.activeClocks[0].key;

        // Per-clock live state — hard-coded boot defaults per clock.  Per
        // BroadcastTimeS Section 5 each clock has independent state, so we
        // keep one slot per active clock.
        state.live = {};
        for (const c of state.activeClocks) {
            state.live[c.key] = {
                hour: 6, minute: 0, month: 10, day: 3, year: 1953,
                rateRaw: 4, running: false,
            };
        }

        registerEvents(state.node);

        // setupProducer for each selected clock BEFORE start() so the C
        // library has the producer/consumer ranges in the node's lists when
        // login fires its automatic Range Identified emissions per spec
        // Section 6.1.  setupProducer also allocates the per-clock state
        // slot inside the broadcast-time protocol handler.
        for (const c of state.activeClocks) {
            try {
                state.node.broadcastTime.setupProducer(c.clockId);
                log(`will generate "${c.label}"`);
            } catch (e) {
                log(`could not register "${c.label}": ${e?.message ?? e}`);
            }
        }

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
    state.activeClocks = [];
    state.focusedKey = null;
    state.live = {};
    setStatus('disconnected');
    show('connect');
    refreshConnectGate();
    log('disconnected');
});

async function softReboot() {
    if (!state.openlcb) return;
    try {
        await state.openlcb.reboot();
    } catch (e) {
        log(`reboot failed: ${e?.message ?? e}`);
        setStatus('disconnected');
        show('connect');
    }
}

// -----------------------------------------------------------------------------
// Connect-screen clock selection — Connect button is gated by "at least one
// clock ticked", and the Custom hex field activates only when its checkbox is.
// -----------------------------------------------------------------------------
function refreshConnectGate() {
    const anyChecked = WELL_KNOWN_CLOCKS.some(wk => $(wk.ck).checked) || $('ckCustom').checked;
    $('btnConnect').disabled = !anyChecked;
    if (!anyChecked) {
        $('connInfo').textContent = 'Tick at least one clock to enable Connect.';
    } else {
        $('connInfo').textContent = 'Not connected.';
    }
}

for (const wk of WELL_KNOWN_CLOCKS) {
    $(wk.ck).addEventListener('change', refreshConnectGate);
}
$('ckCustom').addEventListener('change', () => {
    $('customId').disabled = !$('ckCustom').checked;
    refreshConnectGate();
});
refreshConnectGate();

// -----------------------------------------------------------------------------
// Local clock advance (start/stop the library's internal time tracker)
// -----------------------------------------------------------------------------
// Run / Pause flip the library's internal running state, announce it on
// the wire, and schedule the §6.5 catch-up burst.  We also mirror the new
// state into our own UI directly — the user click is authoritative for
// this node's display, since the C library does not echo producer-side
// API calls back through any callback.
$('btnLocalStart').addEventListener('click', () => {
    if (!state.node) return;
    const cid = currentClockId();
    state.node.broadcastTime.start(cid);
    try { state.node.broadcastTime.sendStart(cid); } catch (e) { log(`broadcast "started" failed: ${e?.message ?? e}`); }
    scheduleSyncBurst(cid);
    state.live[state.focusedKey].running = true;
    renderReadout();
    log(`running "${labelFor(state.focusedKey)}"`);
});
$('btnLocalStop').addEventListener('click', () => {
    if (!state.node) return;
    const cid = currentClockId();
    state.node.broadcastTime.stop(cid);
    try { state.node.broadcastTime.sendStop(cid); } catch (e) { log(`broadcast "stopped" failed: ${e?.message ?? e}`); }
    scheduleSyncBurst(cid);
    state.live[state.focusedKey].running = false;
    renderReadout();
    log(`paused "${labelFor(state.focusedKey)}"`);
});

// -----------------------------------------------------------------------------
// Broadcast — emit each value on the wire from the form above
// -----------------------------------------------------------------------------
function readStaged() {
    // The wire format stores rate as a 12-bit signed fixed-point value (rate * 4).
    // The form takes the user-friendly multiplier; round to the nearest 0.25
    // step the protocol can represent.
    const mult = +$('repRateMult').value;
    const rateRaw = Math.round(clamp(mult, -512, 511.75) * 4);
    return {
        h:    clamp(+$('repHour').value, 0, 23),
        m:    clamp(+$('repMinute').value, 0, 59),
        mo:   clamp(+$('repMonth').value, 1, 12),
        d:    clamp(+$('repDay').value, 1, 31),
        y:    clamp(+$('repYear').value, 0, 4095),
        rate: clamp(rateRaw, -2048, 2047),
    };
}

function bt() { return state.node?.broadcastTime; }

function withClock(label, fn) {
    if (!state.node) { log('not connected'); return; }
    try { fn(currentClockId()); }
    catch (e) { log(`${label} failed: ${e?.message ?? e}`); }
}

// Spec §6.5 out-of-band rule: when the producer's settings are changed via a
// non-network mechanism (in this demo, the user clicking Run/Pause or any
// Broadcast button), 3 seconds after the LAST change the producer should send
// the Section 6.3 catch-up burst.  triggerSyncDelay() resets the underlying
// timer on each call, so a flurry of clicks coalesces into one burst at the
// end.  Date Rollover is excluded — it's a notification of a transition, not
// a state change, and the spec doesn't list it among the triggering events.
function scheduleSyncBurst(cid) {
    try { bt().triggerSyncDelay(cid); }
    catch (e) { log(`schedule snapshot failed: ${e?.message ?? e}`); }
}

// Each Broadcast handler: emit on the wire, schedule §6.5 catch-up burst,
// and mirror the staged value into the focused clock's live slot so our
// own UI reflects what we just sent.  Date Rollover carries no value, so
// it has nothing to mirror.
$('btnReportTime').addEventListener('click',   () => withClock('broadcast time',  (c) => {
    const s = readStaged();
    bt().sendReportTime(c, s.h, s.m);
    scheduleSyncBurst(c);
    state.live[state.focusedKey].hour = s.h;
    state.live[state.focusedKey].minute = s.m;
    renderReadout();
    log(`broadcast time ${pad2(s.h)}:${pad2(s.m)}`);
}));
$('btnReportDate').addEventListener('click',   () => withClock('broadcast date',  (c) => {
    const s = readStaged();
    bt().sendReportDate(c, s.mo, s.d);
    scheduleSyncBurst(c);
    state.live[state.focusedKey].month = s.mo;
    state.live[state.focusedKey].day   = s.d;
    renderReadout();
    log(`broadcast date ${s.mo}/${s.d}`);
}));
$('btnReportYear').addEventListener('click',   () => withClock('broadcast year',  (c) => {
    const s = readStaged();
    bt().sendReportYear(c, s.y);
    scheduleSyncBurst(c);
    state.live[state.focusedKey].year = s.y;
    renderReadout();
    log(`broadcast year ${s.y}`);
}));
$('btnReportRate').addEventListener('click',   () => withClock('broadcast speed', (c) => {
    const s = readStaged();
    bt().sendReportRate(c, s.rate);
    scheduleSyncBurst(c);
    state.live[state.focusedKey].rateRaw = s.rate;
    renderReadout();
    log(`broadcast speed ${rateToFloat(s.rate).toFixed(2)}x`);
}));
$('btnDateRollover').addEventListener('click', () => withClock('broadcast midnight', (c) => { bt().sendDateRollover(c); log('broadcast "midnight crossed"'); }));

$('btnTriggerQueryReply').addEventListener('click', () => withClock('snapshot now', (c) => {
    bt().triggerQueryReply(c);
    log('sending full snapshot to listeners');
}));

// -----------------------------------------------------------------------------
// Live readout
// -----------------------------------------------------------------------------
function pad2(n) { return n.toString().padStart(2, '0'); }

function rateToFloat(raw) { return raw / 4; }

function renderReadout() {
    const live = state.live[state.focusedKey];
    if (!live) {
        $('readTime').textContent = '--:--';
        $('readDate').textContent = '—';
        $('readYear').textContent = '—';
        $('readRate').textContent = '—';
        $('runPill').className = 'pill';
        $('runPill').textContent = '—';
        return;
    }
    $('readTime').textContent = `${pad2(live.hour)}:${pad2(live.minute)}`;
    const monthName = ['—','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][live.month] ?? '—';
    $('readDate').textContent = `${monthName} ${live.day}`;
    $('readYear').textContent = `${live.year}`;
    $('readRate').textContent = `${rateToFloat(live.rateRaw).toFixed(2)}×`;
    const pill = $('runPill');
    pill.className  = `pill ${live.running ? 'running' : 'stopped'}`;
    pill.textContent = live.running ? 'Running' : 'Paused';
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
        // createCommandEventId expects the BroadcastTimeEventType enum index
        // (8/9/10), not the wire-byte values from BroadcastTimeCommand (0xF000+).
        // The C export wasm_bt_create_command_event_id maps the enum to bytes
        // 6/7 of the event ID per BroadcastTimeS §4.9 / §4.10.
        set('builtCmdQuery',     bc.createCommandEventId(c, BroadcastTimeEventType.BROADCAST_TIME_EVENT_QUERY));
        $('builtCmdStartStop').textContent =
            'Start ' + eventHexDot(bc.createCommandEventId(c, BroadcastTimeEventType.BROADCAST_TIME_EVENT_START)) +
            '\nStop  ' + eventHexDot(bc.createCommandEventId(c, BroadcastTimeEventType.BROADCAST_TIME_EVENT_STOP));
    } catch (e) {
        // BigInt range issues on garbage input — fall back to dashes.
    }
}

['repHour','repMinute','repMonth','repDay','repYear','repRateMult'].forEach(id => {
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
// Plain-English status line shown next to the "Showing" header
// -----------------------------------------------------------------------------
function labelFor(key) {
    return state.activeClocks.find(c => c.key === key)?.label ?? '—';
}

function refreshIdentityStatus() {
    if (!state.node || state.focusedKey == null) {
        $('identityStatus').textContent = '—';
        return;
    }
    const cid = currentClockId();
    const ok = cid != null && state.node.broadcastTime.isProducer(cid);
    $('identityStatus').textContent = ok ? `generating "${labelFor(state.focusedKey)}"` : '—';
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo)); }

// -----------------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------------
$('nodeId').value = NODE_ID.toString(16).padStart(12, '0');
renderReadout();
log('ready — click Connect to attach to the network');

// DEBUG-ONLY probe — exposes runtime handles so the validation harness
// can introspect the codec.  Remove for production.
window.__debug = { state, currentClockId };

// =============================================================================
// OpenLCB Broadcast Clock Display (Consumer) — exerciser
// =============================================================================
//
// Counterpart to broadcast_clock_source.  This node is a passive listener
// that can track multiple clocks simultaneously per BroadcastTimeS Section 5.
// The Connect screen lets the operator pick which clocks to track; on
// Connect, setupConsumer is called per clock BEFORE login so the library
// emits the spec Section 6.1 Consumer Range Identified for each at login.
//
// The on-screen control panels operate on the currently focused clock,
// chosen via the chip group on the Clock screen.

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
// Persistent config memory
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
    $('screenTitle').textContent = screen === 'connect' ? 'Connect' : 'Display';
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
const WELL_KNOWN_CLOCKS = [
    { key: 'default-fast',     ck: 'ckDefaultFast',     id: BroadcastTimeClock.DEFAULT_FAST,     label: 'Default Fast' },
    { key: 'default-realtime', ck: 'ckDefaultRealtime', id: BroadcastTimeClock.DEFAULT_REALTIME, label: 'Default Real-time' },
    { key: 'alternate-1',      ck: 'ckAlternate1',      id: BroadcastTimeClock.ALTERNATE_1,      label: 'Alternate 1' },
    { key: 'alternate-2',      ck: 'ckAlternate2',      id: BroadcastTimeClock.ALTERNATE_2,      label: 'Alternate 2' },
];

// Per-clock fresh slot factories so each active clock starts uninitialized
// (the consumer learns state from the producer's Reports, not from CDI).
const freshLive = () => ({
    hour: 0, minute: 0,
    month: 0, day: 0, year: 0,
    rateRaw: 0,
    running: false,
});
const freshRxTime = () => ({
    time: 0, date: 0, year: 0, rate: 0,
    started: 0, stopped: 0, rollover: 0, changed: 0,
});
const freshRxValue = () => ({
    time: '—', date: '—', year: '—', rate: '—',
    started: '—', stopped: '—', rollover: '—', changed: '—',
});

const state = {
    openlcb: null,
    node: null,

    // Populated at Connect.  Each entry: { key, clockId, label }.
    activeClocks: [],
    focusedKey: null,

    // Per-clock state slots, keyed by clockKey.
    live:    {},   // [key]: { hour, minute, ..., running }
    rxTime:  {},   // [key]: { time, date, year, ..., changed }
    rxValue: {},

    // Display preference (not per-clock — it's a node-local UI choice).
    timeFormat: '24',  // '24' | '12'
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

function labelFor(key) {
    return state.activeClocks.find(c => c.key === key)?.label ?? '—';
}

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
            renderReceiveActivity();
            renderCodec();
        });
        group.appendChild(chip);
    }
}

// -----------------------------------------------------------------------------
// Connect-screen multi-clock selection: gate Connect on "any clock ticked",
// activate Custom hex only when its checkbox is.
// -----------------------------------------------------------------------------
function refreshConnectGate() {
    const anyChecked = WELL_KNOWN_CLOCKS.some(wk => $(wk.ck).checked) || $('ckCustom').checked;
    $('btnConnect').disabled = !anyChecked;
    $('connInfo').textContent = anyChecked
        ? 'Not connected.'
        : 'Tick at least one clock to enable Connect.';
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
// Connect / disconnect
// -----------------------------------------------------------------------------
$('btnConnect').addEventListener('click', async () => {
    const url = $('url').value.trim();
    const nodeHex = $('nodeId').value.trim().replace(/[.\s]/g, '');
    if (!url || !nodeHex) return;

    // Defensive — the button is gated by refreshConnectGate but re-check.
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

                // Runtime-level minute tick — fires for any clock the library
                // tracks (including ours).  Stamp the matching clock's slot.
                onBroadcastTimeChanged: (clockId, h, m) => {
                    const key = keyForClockId(clockId); if (!key) return;
                    state.live[key].hour = h;
                    state.live[key].minute = m;
                    markRx(key, 'changed', `${pad2(h)}:${pad2(m)}`);
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
                renderReceiveActivity();
                renderCodec();

                // Ask each tracked clock for its current state right after
                // login so the display catches up instead of waiting for the
                // next minute tick from the generator.
                for (const c of state.activeClocks) {
                    try {
                        state.node.broadcastTime.sendQuery(c.clockId);
                        log(`asked "${c.label}" for current state`);
                    } catch (e) { log(`could not query "${c.label}": ${e?.message ?? e}`); }
                }
            },

            // Updates from the generator on the network — each callback
            // updates the matching clock's slot.
            onBroadcastTimeReceived: (_n, clockId, hour, minute) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].hour = hour; state.live[key].minute = minute;
                markRx(key, 'time', `${pad2(hour)}:${pad2(minute)}`);
                if (key === state.focusedKey) renderReadout();
                log(`got time ${pad2(hour)}:${pad2(minute)} from "${labelFor(key)}"`);
            },
            onBroadcastDateReceived: (_n, clockId, month, day) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].month = month; state.live[key].day = day;
                markRx(key, 'date', `${month}/${day}`);
                if (key === state.focusedKey) renderReadout();
                log(`got date ${month}/${day} from "${labelFor(key)}"`);
            },
            onBroadcastYearReceived: (_n, clockId, year) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].year = year;
                markRx(key, 'year', `${year}`);
                if (key === state.focusedKey) renderReadout();
                log(`got year ${year} from "${labelFor(key)}"`);
            },
            onBroadcastRateReceived: (_n, clockId, rate) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].rateRaw = rate;
                markRx(key, 'rate', `${rateToFloat(rate).toFixed(2)}×`);
                if (key === state.focusedKey) renderReadout();
                log(`got speed ${rateToFloat(rate).toFixed(2)}× from "${labelFor(key)}"`);
            },
            onBroadcastClockStarted: (_n, clockId) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].running = true;
                markRx(key, 'started', '⏵ running');
                if (key === state.focusedKey) renderReadout();
                log(`"${labelFor(key)}" is running`);
            },
            onBroadcastClockStopped: (_n, clockId) => {
                const key = keyForClockId(clockId); if (!key) return;
                state.live[key].running = false;
                markRx(key, 'stopped', '⏸ stopped');
                if (key === state.focusedKey) renderReadout();
                log(`"${labelFor(key)}" is stopped`);
            },
            onBroadcastDateRollover: (_n, clockId) => {
                const key = keyForClockId(clockId); if (!key) return;
                markRx(key, 'rollover', '🔄 midnight');
                log(`"${labelFor(key)}" crossed midnight`);
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

        // Build the active-clocks list from the Connect-screen checkboxes.
        // This drives the Section 6.1 Consumer Range Identified emissions
        // (registered before login via setupConsumer) and the runtime focus
        // chip group.
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

        // Per-clock state slots — fresh / uninitialized; the consumer learns
        // values from incoming Reports.
        state.live = {};
        state.rxTime = {};
        state.rxValue = {};
        for (const c of state.activeClocks) {
            state.live[c.key]    = freshLive();
            state.rxTime[c.key]  = freshRxTime();
            state.rxValue[c.key] = freshRxValue();
        }

        registerEvents(state.node);

        // setupConsumer for each selected clock BEFORE start() so the C
        // library has the consumer ranges in the node's lists when login
        // fires its automatic Section 6.1 Range Identified emissions.
        for (const c of state.activeClocks) {
            try {
                state.node.broadcastTime.setupConsumer(c.clockId);
                log(`will display "${c.label}"`);
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
    state.rxTime = {};
    state.rxValue = {};
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
// Display format toggle (24-hour / 12-hour AM-PM)
// -----------------------------------------------------------------------------
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
// Local interpolation — start/stop the library's internal time tracker for
// the focused clock.  Per BroadcastTimeTN Section 2.6.2 a clock display
// should keep its own internal clock to extrapolate fast-time between Reports.
// -----------------------------------------------------------------------------
$('btnLocalStart').addEventListener('click', () => {
    if (!state.node || state.focusedKey == null) return;
    state.node.broadcastTime.start(currentClockId());
    log(`predicting between updates for "${labelFor(state.focusedKey)}"`);
});
$('btnLocalStop').addEventListener('click', () => {
    if (!state.node || state.focusedKey == null) return;
    state.node.broadcastTime.stop(currentClockId());
    log(`not predicting for "${labelFor(state.focusedKey)}"`);
});

// -----------------------------------------------------------------------------
// Outbound consumer commands — Set Time/Date/Year/Rate, Command Start/Stop, Query
// -----------------------------------------------------------------------------
function readStaged() {
    // The wire format stores rate as a 12-bit signed fixed-point value (rate * 4).
    // The form takes the user-friendly multiplier; round to the nearest 0.25
    // step the protocol can represent.
    const mult = +$('setRateMult').value;
    const rateRaw = Math.round(clamp(mult, -512, 511.75) * 4);
    return {
        h:    clamp(+$('setHour').value, 0, 23),
        m:    clamp(+$('setMinute').value, 0, 59),
        mo:   clamp(+$('setMonth').value, 1, 12),
        d:    clamp(+$('setDay').value, 1, 31),
        y:    clamp(+$('setYear').value, 0, 4095),
        rate: clamp(rateRaw, -2048, 2047),
    };
}

function bt() { return state.node?.broadcastTime; }

function withClock(label, fn) {
    if (!state.node || state.focusedKey == null) { log('not connected'); return; }
    try { fn(currentClockId()); }
    catch (e) { log(`${label} failed: ${e?.message ?? e}`); }
}

$('btnSetTime').addEventListener('click',  () => withClock('set time',  (c) => { const s = readStaged(); bt().sendSetTime(c, s.h, s.m); log(`set time ${pad2(s.h)}:${pad2(s.m)} on "${labelFor(state.focusedKey)}"`); }));
$('btnSetDate').addEventListener('click',  () => withClock('set date',  (c) => { const s = readStaged(); bt().sendSetDate(c, s.mo, s.d); log(`set date ${s.mo}/${s.d} on "${labelFor(state.focusedKey)}"`); }));
$('btnSetYear').addEventListener('click',  () => withClock('set year',  (c) => { const s = readStaged(); bt().sendSetYear(c, s.y); log(`set year ${s.y} on "${labelFor(state.focusedKey)}"`); }));
$('btnSetRate').addEventListener('click',  () => withClock('set speed', (c) => { const s = readStaged(); bt().sendSetRate(c, s.rate); log(`set speed ${rateToFloat(s.rate).toFixed(2)}× on "${labelFor(state.focusedKey)}"`); }));
$('btnCmdStart').addEventListener('click', () => withClock('start',     (c) => { bt().sendCommandStart(c); log(`asked "${labelFor(state.focusedKey)}" to start`); }));
$('btnCmdStop').addEventListener('click',  () => withClock('stop',      (c) => { bt().sendCommandStop(c);  log(`asked "${labelFor(state.focusedKey)}" to stop`); }));
$('btnSendQuery').addEventListener('click', () => withClock('refresh',  (c) => { bt().sendQuery(c);        log(`refreshing from "${labelFor(state.focusedKey)}"`); }));

// -----------------------------------------------------------------------------
// Live readout — focused clock's slot
// -----------------------------------------------------------------------------
function pad2(n) { return n.toString().padStart(2, '0'); }
function rateToFloat(raw) { return raw / 4; }

function renderReadout() {
    const live = state.live[state.focusedKey];
    if (!live) {
        $('readTime').textContent = '--:--';
        $('readAmPm').hidden = true;
        $('readDate').textContent = '—';
        $('readYear').textContent = '—';
        $('readRate').textContent = '—';
        $('runPill').className = 'pill';
        $('runPill').textContent = '—';
        return;
    }

    let h = live.hour;
    let displayHour;
    if (state.timeFormat === '12') {
        const ampm = h >= 12 ? 'PM' : 'AM';
        displayHour = h % 12 || 12;
        $('readAmPm').textContent = ampm;
        $('readAmPm').hidden = false;
    } else {
        displayHour = h;
        $('readAmPm').hidden = true;
    }
    $('readTime').textContent = `${pad2(displayHour)}:${pad2(live.minute)}`;

    const monthName = ['—','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][live.month] ?? '—';
    $('readDate').textContent = live.month ? `${monthName} ${live.day}` : '—';
    $('readYear').textContent = live.year ? `${live.year}` : '—';
    $('readRate').textContent = `${rateToFloat(live.rateRaw).toFixed(2)}×`;

    const pill = $('runPill');
    pill.className  = `pill ${live.running ? 'running' : 'stopped'}`;
    pill.textContent = live.running ? 'Running' : 'Paused';
}

// -----------------------------------------------------------------------------
// Receive activity table — focused clock's per-event rx slots
// -----------------------------------------------------------------------------
function markRx(key, kind, value) {
    if (!state.rxTime[key]) return;
    state.rxTime[key][kind]  = Date.now();
    state.rxValue[key][kind] = value;
    if (key === state.focusedKey) {
        renderReceiveActivity();
        updateFreshness();
    }
}

function renderReceiveActivity() {
    const now = Date.now();
    const t = state.rxTime[state.focusedKey];
    const v = state.rxValue[state.focusedKey];
    document.querySelectorAll('.rx-row').forEach(row => {
        const k = row.dataset.evt;
        const ts = t ? t[k] : 0;
        const val = v ? v[k] : '—';
        row.querySelector('[data-field="val"]').textContent = val;
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
    const t = state.rxTime[state.focusedKey];
    const tsAny = t ? Math.max(...Object.values(t)) : 0;
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
setInterval(() => {
    if (state.focusedKey != null) {
        renderReceiveActivity();
        updateFreshness();
    }
}, 1000);

// -----------------------------------------------------------------------------
// Codec preview + decode
// -----------------------------------------------------------------------------
function renderCodec() {
    const olcb = state.openlcb;
    if (!olcb) return;
    const c = currentClockId();
    if (c == null) return;
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
        // 6/7 of the event ID per BroadcastTimeS Section 4.9 / 4.10.
        set('builtCmdQuery',   bc.createCommandEventId(c, BroadcastTimeEventType.BROADCAST_TIME_EVENT_QUERY));
        $('builtCmdStartStop').textContent =
            'Start ' + eventHexDot(bc.createCommandEventId(c, BroadcastTimeEventType.BROADCAST_TIME_EVENT_START)) +
            '\nStop  ' + eventHexDot(bc.createCommandEventId(c, BroadcastTimeEventType.BROADCAST_TIME_EVENT_STOP));
    } catch { /* ignore garbage */ }
}

['setHour','setMinute','setMonth','setDay','setYear','setRateMult'].forEach(id => {
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
function refreshIdentityStatus() {
    if (!state.node || state.focusedKey == null) {
        $('identityStatus').textContent = '—';
        return;
    }
    const cid = currentClockId();
    const ok = cid != null && state.node.broadcastTime.isConsumer(cid);
    $('identityStatus').textContent = ok ? `displaying "${labelFor(state.focusedKey)}"` : '—';
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
renderReceiveActivity();
log('ready — click Connect to attach to the network');

// DEBUG-ONLY probe — exposes runtime handles so the validation harness
// can introspect the codec.  Remove for production.
window.__debug = { state, currentClockId };

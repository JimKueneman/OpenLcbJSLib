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
    OpenLcb, WebSocketTransport, MTI, Event,
    TrainSearchFlag, TrainSearchSpeedSteps, TrainSearchProtocol,
    TransportBusyError,
} from '../../src/index.js';
import { LocalStorageConfigMemory } from '../../src/storage/localstorage-config-memory.js';
import {
    NODE_ID,
    OpenLcbUserConfig_node_parameters,
} from './openlcb_user_config.js';
import { registerEvents } from './register_events.js';

// Persist Configuration Memory across reloads.  Size derives from the
// throttle's declared 0xFD address space so the two stay in sync.
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

// Safety margin we subtract from the train's stated heartbeat deadline
// before scheduling our own auto-Noop.  Leaves room for clock skew, GC
// pauses, and the watchdog's 500 ms polling interval.
const HEARTBEAT_REPLY_MARGIN_MS = 500;

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
    trackProto: 'any',        // 'any' | 'openlcb' | 'mfx' | 'mm' | 'dcc' — default Any so the user finds whatever's there
    dccLong: false,           // default short (DCC 3 is the universal "out-of-the-box" address)
    mmVersion: 'any',         // 'any' | 'v1' | 'v2' | 'v2ext'
    stepMode: 0,              // 0 = Default/Any, 14, 28, 128 — TrainSearchS Table 4 DCC bits 1-0

    pendingSearchEvent: null,
    searchHits: new Map(),    // dccAddr -> { addr, long, nodeId, alias, status }
    // Debug/test: when true, transport.send is a no-op.  Simulates the
    // throttle disappearing from the network.  Toggled by the
    // Debug / Test → "Go Silent" button.  Reload restores normal behavior.
    testSilent: false,
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

        // Throttle parameters live in openlcb_user_config.js — same
        // pattern as the CLib's openlcb_user_config.c.  Throttle is an
        // event sender/receiver, NOT a train: protocolSupport here does
        // NOT include PSI.TRAIN_CONTROL on purpose.
        state.throttleNode = state.openlcb.createNode(BigInt('0x' + nodeHex), OpenLcbUserConfig_node_parameters, {
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
            // The train tells us how many seconds it will wait for any reply
            // (a user command OR a No-op).  The watchdog at the bottom of this
            // file polls state.hbRequestDeadline; user actions (sendCurrentSpeed,
            // sendSetFunction, sendEStop) also implicitly clear the deadline
            // via pokeAlerter() so we don't waste a Noop frame when the user
            // is actively driving.
            onTrainHeartbeatRequest: (_node, timeoutSeconds) => {
                if (!state.train) return;
                const windowMs = Math.max(
                    HEARTBEAT_REPLY_MARGIN_MS,
                    (timeoutSeconds | 0) * 1000 - HEARTBEAT_REPLY_MARGIN_MS,
                );
                state.hbRequestDeadline = Date.now() + windowMs;
                $('alerter').className = 'alerter warn';
                log(`heartbeat request (deadline ${timeoutSeconds}s, replying within ${windowMs}ms)`);
            },

            // No throttle-side onTrainHeartbeatTimeout: the C library's
            // on_heartbeat_timeout fires on the *train's* node, which lives
            // in the CS runtime, not the throttle's.  The throttle has no
            // protocol-level signal that the train timed out — the design
            // assumption is the throttle replies in time and never finds out
            // it failed.  Fix A (CLib sends actual remaining time, not full
            // configured period) makes that assumption hold.

            // Configuration Memory persists in localStorage, keyed by NodeID.
            // ACDI User name/description (offsets 0..126 of space 0xFD per
            // CONFIG_MEM_CONFIG_USER_NAME_OFFSET / _DESCRIPTION_OFFSET) and
            // every CDI-defined byte ride this same path.
            onConfigMemRead:  cfgMem.read.bind(cfgMem),
            onConfigMemWrite: cfgMem.write.bind(cfgMem),

            // Memory Configuration ops — fired by the WASM bridge after
            // the library has already sent the datagram-OK reply.
            onUpdateComplete: (n) => log(`config update complete on ${hexDot(n.id)}`),
            onReboot:         (n) => { log(`reset/reboot received for ${hexDot(n.id)}`); softReboot(); },
            onFactoryReset:   (n) => {
                log(`factory reset received for ${hexDot(n.id)} — clearing storage`);
                cfgMem.clear(n.id);
            },
        });

        // Register the wizard-derived producer/consumer events on this node.
        // For Train Controller: 4 emergency event producers (UNKNOWN status)
        // + IS_TRAIN consumer + any user-selected Well Known Events.
        registerEvents(state.throttleNode);

        // Test hook — when state.testSilent is true, drop all outgoing
        // frames at the transport layer.  Simulates the throttle vanishing
        // from the network (yanked cable / dead radio) so the train sees
        // controller silence and exercises the §6.6 heartbeat-timeout path.
        // Inbound continues to flow so the UI keeps reading the bus.
        const _origSend = state.openlcb._transport.send.bind(state.openlcb._transport);
        state.openlcb._transport.send = (data) => {
            if (state.testSilent) return;
            return _origSend(data);
        };

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

// Soft reboot — discards the WASM module and re-instantiates a fresh stack,
// keeping the WebSocket open.  After this, the throttle node has a new
// alias and any prior train assignment is invalid (the train side dropped
// us).  Reset throttle-local UI state to match.
async function softReboot() {
    if (!state.openlcb) return;
    state.train = null;
    state.searchHits.clear();
    state.pendingVerify.clear();
    state.pendingSearchEvent = null;
    stopHeartbeatWatchdog();
    renderRoster();
    show('roster');
    try {
        await state.openlcb.reboot();
        // onLoginComplete fires for the fresh node on the existing transport.
    } catch (e) {
        log(`reboot failed: ${e?.message ?? e}`);
        setStatus('disconnected');
        show('connect');
    }
}

// =============================================================================
// Roster / search
// =============================================================================

// Generic flag chips (data-flag): Exact / Addr only / Allocate.
// Force long (data-dcc="long") is a sibling chip in the same group but
// has its own handler below, so we skip it here.
document.querySelectorAll('#flagGroup .chip[data-flag]').forEach(c => {
    // Reflect initial state.flags into the chip's visual state.
    const f = c.dataset.flag;
    if (state.flags[f]) c.classList.add('on');
    c.addEventListener('click', () => {
        if (c.classList.contains('disabled')) return;
        state.flags[f] = !state.flags[f];
        c.classList.toggle('on', state.flags[f]);
        updateSearchPreview();
    });
});

function updateProtoVisibility() {
    // When Any is selected, the search will accept BOTH DCC and MM matches,
    // so both sub-option groups are reachable.  When a specific family is
    // selected, only that family's sub-options are visible.
    const showDcc = state.trackProto === 'any' || state.trackProto === 'dcc';
    const showMm  = state.trackProto === 'any' || state.trackProto === 'mm';
    $('chipForceLong').hidden   = !showDcc;
    $('dccStepsSection').hidden = !showDcc;
    $('mmSection').hidden       = !showMm;
}

document.querySelectorAll('#protoGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.trackProto = c.dataset.proto;
        document.querySelectorAll('#protoGroup .chip').forEach(o => o.classList.toggle('on', o === c));
        updateProtoVisibility();
        updateSearchPreview();
    });
});

// Force long lives in #flagGroup but is identified by data-dcc="long" so
// we can find it regardless of where it's parented in the DOM.
document.querySelectorAll('.chip[data-dcc="long"]').forEach(c => {
    c.addEventListener('click', () => {
        if (c.hidden || c.classList.contains('disabled')) return;
        state.dccLong = !state.dccLong;
        c.classList.toggle('on', state.dccLong);
        updateSearchPreview();
    });
});

document.querySelectorAll('#mmGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.mmVersion = c.dataset.mm;
        document.querySelectorAll('#mmGroup .chip').forEach(o => o.classList.toggle('on', o === c));
        updateSearchPreview();
    });
});

document.querySelectorAll('#stepGroup .chip').forEach(c => {
    c.addEventListener('click', () => {
        state.stepMode = parseInt(c.dataset.step, 10);
        document.querySelectorAll('#stepGroup .chip').forEach(o => o.classList.toggle('on', o === c));
        // Speed-step chip controls the throttle's slider resolution too,
        // but only when a real step mode is picked (Default = leave at 128).
        if (state.stepMode > 0) {
            $('speed').max = state.stepMode;
            updateSpeedReadout();
        }
        updateSearchPreview();
    });
});

// Help toggle on the Find a Train card head — collapses every .hint-inline
// underneath, for users who've outgrown the tutorial text.  State persists
// across reloads via localStorage.
const HELP_LS_KEY = 'throttle.findCard.helpHidden';
function applyHelpVisibility() {
    const card = $('findCard');
    const hide = localStorage.getItem(HELP_LS_KEY) === '1';
    card.classList.toggle('hide-help', hide);
    $('btnToggleHelp').textContent = hide ? 'Show help' : 'Hide help';
}
$('btnToggleHelp').addEventListener('click', () => {
    const nowHidden = !$('findCard').classList.contains('hide-help');
    localStorage.setItem(HELP_LS_KEY, nowHidden ? '1' : '0');
    applyHelpVisibility();
});
applyHelpVisibility();

// Always strip everything except digits and term separators (space, comma)
// from the query input.  The wire format only encodes digits + 0xF
// separator (TrainSearchS §5.2 Table 2), so letters can never make it onto
// the bus — accepting them would be misleading.
function applyQueryFilter() {
    const el = $('q');
    const filtered = el.value.replace(/[^\d\s,]/g, '');
    if (filtered !== el.value) {
        const caret = el.selectionStart;
        el.value = filtered;
        if (caret != null) el.setSelectionRange(Math.min(caret, filtered.length), Math.min(caret, filtered.length));
    }
}

$('q').addEventListener('input', () => {
    applyQueryFilter();
    updateSearchPreview();
});

function buildSearchFlags() {
    let f = 0;
    if (state.flags.alloc) f |= TrainSearchFlag.ALLOCATE;
    if (state.flags.exact) f |= TrainSearchFlag.EXACT;
    // Address-only is invalid for multi-term queries (multi-term can't
    // match Address per spec §6.3) — encoder forces it off in that case.
    if (state.flags.addr && parseSearchTerms($('q').value).length <= 1) {
        f |= TrainSearchFlag.ADDRESS_ONLY;
    }
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
            // stepMode 0 = Default/Any — emit no step bits (spec STEPS_DEFAULT)
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

// =============================================================================
// Query encoding — TrainSearchS §5.2
// =============================================================================
//
// The 6-nibble query in bytes 5-7 of the Event ID supports:
//   - single digit run                   "415"        → FFF415
//   - multi-term AND with F separator    "47 415"     → 47F415
//   - empty / match-all                  ""           → FFFFFF
//
// Per spec §6.3, multi-term queries can ONLY match Name (not Address).
// The encoder enforces this by zeroing the Address-only flag on multi-term.

function parseSearchTerms(text) {
    if (!text) return [];
    return text.split(/[\s,]+/).map(t => t.replace(/\D/g, '')).filter(Boolean);
}

function buildSearchQueryBytes(text) {
    const terms = parseSearchTerms(text);
    if (terms.length === 0) {
        return [0xFF, 0xFF, 0xFF];   // match-all
    }
    const joined = terms.join('F');
    if (joined.length > 6) {
        throw new RangeError(`Query too long: ${joined.length} digit-nibbles, max 6 (use shorter terms)`);
    }
    const padded = joined.padStart(6, 'F');   // MSB-first
    return [
        (parseInt(padded[0], 16) << 4) | parseInt(padded[1], 16),
        (parseInt(padded[2], 16) << 4) | parseInt(padded[3], 16),
        (parseInt(padded[4], 16) << 4) | parseInt(padded[5], 16),
    ];
}

function buildSearchEventId(queryBytes, flags) {
    // 09.00.99.FF.qq.qq.qq.rr  per TrainSearchS §5.2 Table 1
    const prefix = 0x090099FFn;
    const q = (BigInt(queryBytes[0]) << 16n) | (BigInt(queryBytes[1]) << 8n) | BigInt(queryBytes[2]);
    return (prefix << 32n) | (q << 8n) | BigInt(flags);
}

// =============================================================================
// Live preview + UI mutual-exclusion rules
// =============================================================================

function updateSearchPreview() {
    const text = $('q').value;
    const terms = parseSearchTerms(text);
    const isMulti = terms.length > 1;
    const isEmpty = terms.length === 0;

    // ----- Address-only chip auto-greys for multi-term ---------------------
    const addrChip = document.querySelector('#flagGroup .chip[data-flag="addr"]');
    addrChip.classList.toggle('disabled', isMulti);
    addrChip.title = isMulti
        ? 'Disabled: multi-term queries can only match Name (spec §6.3)'
        : 'Match against Address only, not Name';

    // ----- Encode -----------------------------------------------------------
    let qBytes, qHex;
    try {
        qBytes = buildSearchQueryBytes(text);
        qHex = qBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    } catch (e) {
        $('eventPreview').textContent = '— (search number is too long)';
        $('flagPreview').textContent  = '—';
        $('hintQuery').textContent    = 'That search has too many digits. Try shorter numbers, or fewer numbers.';
        $('hintResult').textContent   = '⚠ Cannot search until the number is shortened.';
        $('btnSearch').disabled = true;
        return;
    }
    const flags = buildSearchFlags();
    const eventHex = '09.00.99.FF.' + qHex.match(/../g).join('.') + '.' + flags.toString(16).toUpperCase().padStart(2, '0');
    $('eventPreview').textContent = eventHex;
    $('flagPreview').textContent  = '0x' + flags.toString(16).toUpperCase().padStart(2, '0');
    $('btnSearch').disabled = false;

    // ----- Hint row 1: Query ------------------------------------------------
    if (isEmpty) {
        $('hintQuery').textContent = 'Type a number to search for. An empty box will not find anything.';
    } else if (isMulti) {
        $('hintQuery').textContent = `Find trains whose name contains all of these numbers: ${terms.map(t => `"${t}"`).join(' and ')}.`;
    } else {
        $('hintQuery').textContent = `Find the train with DCC address ${terms[0]}, or any train whose name contains "${terms[0]}".`;
    }

    // ----- Hint row 2: Flags — always show all three lines, in chip order ---
    // Each line is its own visual block with a dimmed label prefix so it
    // reads as discrete blocks of info, not a paragraph.
    const fLines = [];
    const tag = (label, body) => `<div class="flag-line"><span class="flag-name">${label}</span> ${body}</div>`;

    // 1. Exact (matches chip order).  When Exact is OFF, the example we
    // show depends on whether Addr-only is also active — the search scope
    // changes (Address-only vs. Address-and-Name).
    const effectiveAddrOnly = state.flags.addr && !isMulti;
    if (state.flags.exact) {
        fLines.push(tag('Exact:', 'match this number only — no partial matches.'));
    } else if (effectiveAddrOnly) {
        fLines.push(tag('Exact:', 'partial prefix matching — typing "47" will find "47", "470", "471", … it will not find "5470", "1347", …'));
    } else {
        fLines.push(tag('Exact:', 'partial prefix matching — typing "47" will find "47", "SP 470", "471", … it will not find "5470", "UP 1347", …'));
    }

    // 2. Addr only
    if (isMulti) {
        fLines.push(tag('Addr only:', 'not used — multi-number searches always look in the train\'s name.'));
    } else {
        fLines.push(tag('Addr only:', state.flags.addr
            ? 'search by DCC address only — ignore the train\'s name.'
            : 'search both DCC address and the train\'s name.'));
    }

    // 3. Allocate
    fLines.push(tag('Allocate:', state.flags.alloc
        ? 'if no train responds, the command station will create a new train at this address.'
        : 'if no train responds, no new train will be created.'));

    // 4. Force long (only when the chip is visible — Any or DCC protocol)
    const showForceLong = state.trackProto === 'any' || state.trackProto === 'dcc';
    if (showForceLong) {
        fLines.push(tag('Force long:', state.dccLong
            ? 'only finds DCC long (14-bit) trains. Numbers 1–127 must use a short address.'
            : 'numbers 1–127 use short DCC addresses; 128+ use long. Turn on to find a long-address train at 1–127.'));
    }

    // 5. Result — what will happen when Search is clicked.  Stays as the
    //    last line of the Flags hint block so it's right after the orthogonal
    //    flag descriptions and reads as the conclusion.
    let result;
    if (isEmpty && state.flags.alloc) {
        result = '⚠ Type a number first. With Allocate on but no number, the command station has no address to use.';
    } else if (isEmpty) {
        result = '⚠ Type a number to search. An empty box will not find any trains.';
    } else if (state.flags.alloc && state.flags.exact) {
        result = 'Look for this exact train. If it is not on the network, a new one will be created.';
    } else if (state.flags.alloc && !state.flags.exact) {
        result = '⚠ Without Exact, a partial match (like finding 470 when you typed 47) will prevent creating a new train. For best results, turn on Exact too.';
    } else if (state.flags.exact) {
        result = 'Find this exact train if it is already on the network. Will not create one.';
    } else {
        result = 'Find any train whose DCC address starts with what you typed, or whose name contains a number starting with what you typed. Will not create one.';
    }
    fLines.push(tag('Result:', result));

    $('hintFlags').innerHTML = fLines.join('');
    // Keep the legacy hintResult element in sync (used by error paths).
    $('hintResult').textContent = result;

    // ----- Hint row 3: Protocol --------------------------------------------
    const protoLabels = {
        any:     'Find any kind of train.',
        openlcb: 'Only find native OpenLCB trains.',
        mfx:     'Only find MFX / M4 trains.',
        mm:      'Only find Märklin-Motorola trains.',
        dcc:     'Only find DCC trains.',
    };
    $('hintProto').textContent = protoLabels[state.trackProto];

    // ----- Protocol-specific hints (panels above already hide; just fill text) --
    const mmLabels = {
        any:    'Any version of MM is fine.',
        v1:     'v1 — older MM, 14 speed steps and F0 only.',
        v2:     'v2 — directional, F0 through F4.',
        v2ext:  'v2 extended — adds F5–F8.',
    };
    $('hintMm').textContent = mmLabels[state.mmVersion];

    // (Force long hint moved to the Flags hint block above, since the chip
    // now lives in the Flags row for quick access.)
    $('hintDccSteps').textContent = state.stepMode === 0
        ? 'Let the train use whatever speed step setting it has (recommended).'
        : `Suggest ${state.stepMode} speed steps to the train. Trains will respond regardless of which value you pick here.`;

    // (Result line is built inside the Flags hint block above as the last
    // flag-line — it's the conclusion drawn from the orthogonal flags.)
}

$('btnSearch').addEventListener('click', () => {
    if (!state.openlcb || !state.throttleNode) return;

    const text = $('q').value;
    let qBytes;
    try {
        qBytes = buildSearchQueryBytes(text);
    } catch (e) {
        log(`search query invalid: ${e.message}`);
        return;
    }

    const flags = buildSearchFlags();
    const eventId = buildSearchEventId(qBytes, flags);
    state.pendingSearchEvent = eventId;
    state.searchHits.clear();
    renderRoster();

    try {
        state.throttleNode.sendEventWithMti(eventId, MTI.PRODUCER_IDENTIFY);
    } catch (e) {
        log(`search send failed: ${e?.message ?? e}`);
        return;
    }

    const terms = parseSearchTerms(text);
    const summary = terms.length === 0 ? 'match-all' : terms.join(' AND ');
    log(`search "${summary}" flags=0x${flags.toString(16).padStart(2,'0')} event=${eventId.toString(16).toUpperCase()}`);
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
// Debug / Test — silence the throttle to exercise the heartbeat-timeout path
// =============================================================================

$('btnTestSilent').addEventListener('click', () => {
    state.testSilent = !state.testSilent;
    const btn = $('btnTestSilent');
    if (state.testSilent) {
        btn.textContent = 'TEST: Resume';
        btn.classList.add('test-active');
        log('TEST: throttle silenced — all outgoing frames dropped');
    } else {
        btn.textContent = 'TEST: Go Silent';
        btn.classList.remove('test-active');
        log('TEST: throttle resumed — outgoing frames flowing again ' +
            '(train state may be stale; bump the slider to resync)');
    }
});

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

// Pre-fill the form's Node ID input from openlcb_user_config.js.  The
// operator can still override it before clicking Connect.
$('nodeId').value = NODE_ID.toString(16).padStart(12, '0');

updateSpeedReadout();
renderFunctions();
updateProtoVisibility();   // sync sub-section visibility with state.trackProto on first paint
updateSearchPreview();
log('ready — click Connect to attach to JMRI');

// Run OpenLcbJSLib as a conformance target behind a TCP-GridConnect server,
// suitable for driving with OlcbCheckerClone (default: localhost:12021).
//
// Modes mirror OpenLcbCLib/test/compliance_node/ComplianceTestNode/protocol_modes.c.
// Each mode advertises a different PIP bitmask and sets up the matching
// application-layer state. The checker is run once per mode.
//
//   node test/harness/run-node.mjs [--mode basic|train|broadcast-time-producer|broadcast-time-consumer|detector]
//                                  [--port 12021] [--node-id 05.01.01.01.07.07]
//                                  [--trace] [--fresh]
//
// ─────────────────────────────────────────────────────────────────────────
// Multi-node handling in `train` mode (important — see shortCircuitNodeToRun)
// ─────────────────────────────────────────────────────────────────────────
// Train mode allocates the main target node (NODE_ID) plus 3 virtual trains
// (NODE_ID+1..+3) because the train-search protocol tests (ts*) need
// unassigned virtual slots for search-allocation.
//
// OlcbCheckerClone is a 1:1 checker — it is NOT designed for a DUT that
// exposes multiple virtual nodes behind one link. Specifically,
// check_me10_init sends a reset datagram and then fails on the *first*
// Initialization_Complete frame whose source isn't the target node. With 4
// nodes all going through CAN+OpenLCB login on reboot, the emission order is
// a race — any of the 3 virtuals can beat the main node to the wire and
// trip the check.
//
// Fix: short-circuit the 3 virtuals past their full login sequence into
// RUNSTATE_RUN with a pre-registered alias mapping. They still participate
// in addressed-message traffic (Verify_NodeID_Addressed, train-search, SNIP,
// etc.) but do NOT emit startup broadcasts (Initialization_Complete,
// Producer_Identified, Consumer_Identified). Only the main target node goes
// through the real login path, both at startup and on reboot. This is safe
// in harness code — we own every node on this "bus," there are no real
// participants that could collide, and the goal is to present the checker
// with the 1:1 view it was designed for.

import {
    OpenLcbConfig, defines, EVENT_STATUS, generateAlias,
} from '../../src/index.js';
import { TRAIN_SEARCH_FLAG_LONG_ADDR, RUNSTATE_RUN } from '../../src/openlcb/defines.js';
import {
    encodeEventId as dccDetectorEncodeEventId,
    makeShortAddress as dccDetectorMakeShortAddress,
    DCC_DETECTOR_OCCUPIED_FORWARD,
    DCC_DETECTOR_UNOCCUPIED,
    DCC_DETECTOR_OCCUPIED_UNKNOWN,
    DCC_DETECTOR_TRACK_EMPTY,
} from '../../src/openlcb/application-dcc-detector.js';
import { FileConfigMemory } from '../../src/storage/file-config-memory.js';
import { TcpGridConnectServer } from './tcp-gridconnect-server.mjs';

// -----------------------------------------------------------------------------
// Argv parsing
// -----------------------------------------------------------------------------

const argv = process.argv.slice(2);
function getArg(flag, def) {
    const i = argv.indexOf(flag);
    if (i === -1) return def;
    return argv[i + 1];
}
function getFlag(flag) { return argv.includes(flag); }

const PORT = parseInt(getArg('--port', '12021'), 10);
const NODE_ID_STR = getArg('--node-id', '05.01.01.01.07.07');
const MODE = getArg('--mode', 'basic');
const TRACE = getFlag('--trace') || getFlag('-T');
const FRESH = getFlag('--fresh');

const NODE_ID = BigInt('0x' + NODE_ID_STR.replace(/\./g, ''));

const log = (...args) => console.log(new Date().toISOString().slice(11, 23), ...args);

function nodeIdToString(id) {
    const hex = id.toString(16).padStart(12, '0');
    return `${hex.slice(0, 2)}.${hex.slice(2, 4)}.${hex.slice(4, 6)}.${hex.slice(6, 8)}.${hex.slice(8, 10)}.${hex.slice(10, 12)}`;
}

/**
 * Short-circuit a virtual node past CAN login + OpenLCB login, leaving it in
 * RUNSTATE_RUN with a registered alias mapping. Harness-only: the test bus is
 * not a real CAN network, we own every participant, and aliases are picked
 * from a deterministic generator that can't collide in this closed setup.
 *
 * Used for multi-node train-mode virtuals so check_me10_init — designed for a
 * 1:1 DUT — doesn't observe three additional Initialization_Complete frames
 * after a reboot datagram.
 *
 * Must be invoked AFTER createNode() and AFTER applicationTrain.setup().
 * Safe to re-invoke on reboot (re-registers the alias if resetState() cleared
 * `permitted`).
 */
function shortCircuitNodeToRun(config, vNode) {
    // Pick a deterministic alias from the node ID, stepping the seed past any
    // alias already claimed by a sibling we registered earlier in this call.
    vNode.seed = vNode.id;
    vNode.alias = generateAlias(vNode.seed);
    while (vNode.alias === 0 || config.aliasMappings.findMappingByAlias(vNode.alias) !== null) {
        // Nudge the seed until we find a free alias. Reuses the same LFSR
        // progression as the real login path — collisions are astronomically
        // rare with our 3-virtual count but we handle them anyway.
        vNode.seed = (vNode.seed + 1n) & 0xFFFFFFFFFFFFn;
        vNode.alias = generateAlias(vNode.seed);
    }

    config.aliasMappings.register(vNode.alias, vNode.id);
    const mapping = config.aliasMappings.findMappingByAlias(vNode.alias);
    if (mapping) mapping.isPermitted = true;

    vNode.state.permitted   = true;
    vNode.state.initialized = true;
    vNode.state.runState    = RUNSTATE_RUN;
}

// -----------------------------------------------------------------------------
// Minimal CDI — valid against cdi.xsd, one editable string segment at 0xFD.
// -----------------------------------------------------------------------------

const CDI_XML = `<?xml version="1.0" encoding="utf-8"?>
<cdi xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://openlcb.org/schema/cdi/1/3/cdi.xsd">
<identification>
<manufacturer>OpenLcbJSLib</manufacturer>
<model>Test Node</model>
<hardwareVersion>1.0</hardwareVersion>
<softwareVersion>${defines.OPENLCB_JS_LIB_VERSION}</softwareVersion>
</identification>
<segment space="253" origin="0">
<name>Node</name>
<group>
<name>User identification</name>
<string size="63"><name>User Name</name></string>
<string size="64"><name>User Description</name></string>
</group>
</segment>
</cdi>\0`;
const CDI_BYTES = new TextEncoder().encode(CDI_XML);

// Minimal FDI — exactly the XML shipped in OpenLcbCLib's compliance node
// (one binary headlight function). Validates against fdi-1-0.xsd.
const FDI_XML = `<?xml version="1.0"?><fdi xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://openlcb.org/schema/fdi/1/1/fdi.xsd"><segment><function kind="binary"><name>Headlight</name><number>0</number></function></segment></fdi> \0`;
const FDI_BYTES = new TextEncoder().encode(FDI_XML);

// -----------------------------------------------------------------------------
// Mode registry — one object per compliance mode
// -----------------------------------------------------------------------------

const BASE_PIP =
    defines.PSI_EVENT_EXCHANGE |
    defines.PSI_SIMPLE_NODE_INFORMATION |
    defines.PSI_DATAGRAM |
    defines.PSI_MEMORY_CONFIGURATION |
    defines.PSI_CONFIGURATION_DESCRIPTION_INFO |
    defines.PSI_STREAM;

function buildBaseParameters(snipModel, extraPip = 0) {
    return {
        protocolSupport: BASE_PIP | extraPip,
        cdi: CDI_BYTES,
        snip: {
            mfgVersion: 1,
            name: 'OpenLcbJSLib',
            model: snipModel,
            hardwareVersion: '1.0',
            softwareVersion: defines.OPENLCB_JS_LIB_VERSION,
            userVersion: 1,
        },
        addressSpaceConfigurationDefinitionInfo: { present: true,  readOnly: true,  highestAddress: CDI_BYTES.length - 1, lowAddressValid: false, description: 'CDI' },
        addressSpaceAll:                          { present: false, highestAddress: 0 },
        addressSpaceConfigMemory:                 { present: true,  readOnly: false, highestAddress: 256, lowAddressValid: false, description: 'Config' },
        addressSpaceAcdiManufacturer:             { present: false, highestAddress: 0 },
        addressSpaceAcdiUser:                     { present: false, highestAddress: 0 },
        addressSpaceTrainFunctionDefinitionInfo:  { present: false, highestAddress: 0 },
        addressSpaceTrainFunctionConfigMemory:    { present: false, highestAddress: 0 },
        addressSpaceFirmware:                     { present: false, highestAddress: 0 },
        configurationOptions: {
            highAddressSpace: 0xFF,
            lowAddressSpace:  0xFD,
            description: 'OpenLcbJSLib test node',
            // Library advertises Stream in PIP and the config-mem-stream
            // bridge is wired, so Config Options agrees.
            streamReadWriteSupported: true,
        },
    };
}

const MODES = {
    basic: {
        description: 'Basic Node — core compliance (sections 0-6, 11)',
        makeParameters: () => buildBaseParameters('Basic Mode'),
        setup(config, node) {
            config.application.registerConsumerEventId(node, defines.EVENT_ID_EMERGENCY_STOP,        EVENT_STATUS.UNKNOWN);
            config.application.registerConsumerEventId(node, defines.EVENT_ID_CLEAR_EMERGENCY_STOP,  EVENT_STATUS.UNKNOWN);
            config.application.registerProducerEventId(node, defines.EVENT_ID_DUPLICATE_NODE_DETECTED,    EVENT_STATUS.UNKNOWN);
            config.application.registerProducerEventId(node, defines.EVENT_ID_IDENT_BUTTON_COMBO_PRESSED, EVENT_STATUS.UNKNOWN);
            log(`registered ${node.producers.count} producers, ${node.consumers.count} consumers`);
        },
    },

    train: {
        description: 'Train Node — train control + search + FDI (sections 7, 8, 9, 11)',
        makeParameters: () => {
            const p = buildBaseParameters(
                'Train Mode',
                defines.PSI_TRAIN_CONTROL | defines.PSI_FUNCTION_DESCRIPTION,
            );
            p.fdi = FDI_BYTES;
            p.addressSpaceTrainFunctionDefinitionInfo = {
                present: true,
                readOnly: true,
                highestAddress: FDI_BYTES.length - 1,
                lowAddressValid: false,
                description: 'Train Function Definition Information',
            };
            return p;
        },
        setup(config, node) {
            // Main train: DCC address 3, 128 speed steps (3), 3s heartbeat.
            config.applicationTrain.setup(node);
            config.applicationTrain.setDccAddress(node, 3, false);
            config.applicationTrain.setSpeedSteps(node, 3);
            if (node.trainState) {
                node.trainState.heartbeatTimeoutS = 3;
                node.trainState.heartbeatCounter100ms = 0;
            }

            // Pre-allocate 3 virtual trains for the search-allocation tests.
            // C reference: protocol_modes.c setup_train() — IDs are id+1..id+3,
            // each gets applicationTrain.setup() but no DCC address (assigned
            // on search-allocation).
            //
            // Virtuals are short-circuited past CAN+OpenLCB login into
            // RUNSTATE_RUN so only the main node emits Initialization_Complete
            // on startup and after reboot — see shortCircuitNodeToRun() for
            // rationale.
            for (let i = 1n; i <= 3n; i++) {
                const virtualId = node.id + i;
                const vNode = config.createNode(virtualId, node.parameters);
                if (vNode) {
                    config.applicationTrain.setup(vNode);
                    shortCircuitNodeToRun(config, vNode);
                    log(`allocated virtual train ${nodeIdToString(vNode.id)} alias=0x${vNode.alias.toString(16)} (skipped login)`);
                }
            }
        },
    },

    detector: {
        description: 'DCC Detector — producer of detector-format events (section dd)',
        makeParameters: () => buildBaseParameters('DCC Detector Mode'),
        setup(config, node) {
            // Register a representative set of detector-format producer events
            // so the dd10/dd20/dd30/dd40 checks have something to validate:
            //   * an occupied-forward entry on DCC short address 42
            //   * the matching unoccupied (exit) event
            //   * a track-empty sentinel (dd40 is info-only but we advertise it)
            const shortAddr = dccDetectorMakeShortAddress(42);
            const occupiedForward = dccDetectorEncodeEventId(
                node.id, DCC_DETECTOR_OCCUPIED_FORWARD, shortAddr);
            const unoccupied = dccDetectorEncodeEventId(
                node.id, DCC_DETECTOR_UNOCCUPIED, shortAddr);
            const trackEmpty = dccDetectorEncodeEventId(
                node.id, DCC_DETECTOR_OCCUPIED_UNKNOWN, DCC_DETECTOR_TRACK_EMPTY);

            config.application.registerProducerEventId(node, occupiedForward, EVENT_STATUS.UNKNOWN);
            config.application.registerProducerEventId(node, unoccupied,      EVENT_STATUS.UNKNOWN);
            config.application.registerProducerEventId(node, trackEmpty,      EVENT_STATUS.UNKNOWN);
            log(`registered ${node.producers.count} detector producer events`);
        },
    },

    'broadcast-time-producer': {
        description: 'Broadcast Time Producer — fast-clock producer (section 10)',
        makeParameters: () => buildBaseParameters('BroadcastTime Producer'),
        setup(config, node) {
            config.applicationBroadcastTime.setupProducer(
                node, defines.BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK,
            );
            log('broadcast time producer armed on default fast clock');
        },
    },

    'broadcast-time-consumer': {
        description: 'Broadcast Time Consumer — fast-clock consumer (section 10)',
        makeParameters: () => buildBaseParameters('BroadcastTime Consumer'),
        setup(config, node) {
            config.applicationBroadcastTime.setupConsumer(
                node, defines.BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK,
            );
            log('broadcast time consumer armed on default fast clock');
        },
    },
};

const mode = MODES[MODE];
if (!mode) {
    console.error(`Unknown --mode '${MODE}'. Valid: ${Object.keys(MODES).join(', ')}`);
    process.exit(2);
}

// -----------------------------------------------------------------------------
// Optional protocol trace
// -----------------------------------------------------------------------------

function tracer(direction, gc) {
    if (!TRACE) return;
    const arrow = direction === 'rx' ? '<-' : '->';
    process.stdout.write(`  ${arrow} ${gc.trim()}\n`);
}

// -----------------------------------------------------------------------------
// Wire up transport + library
// -----------------------------------------------------------------------------

const transportFactory = (handlers) => new TcpGridConnectServer({
    port: PORT,
    host: '0.0.0.0',
    onCanFrame:   handlers.onCanFrame,
    onConnect:    () => { log('TCP client connected'); handlers.onConnect?.(); },
    onDisconnect: (reason) => { log(`TCP client disconnected: ${reason}`); handlers.onDisconnect?.(true, 0, reason); },
    onError:      (err) => { log(`transport error: ${err.message}`); handlers.onError?.(err); },
    onTrace:      tracer,
});

const cfgMem = new FileConfigMemory({ directory: './.openlcb-cfg', size: 1024 });
if (FRESH) {
    cfgMem.clear(NODE_ID);
    log('cleared persistent config memory for this node');
}

const config = new OpenLcbConfig({
    transport: transportFactory,
    configMemoryRead:  cfgMem.read.bind(cfgMem),
    configMemoryWrite: cfgMem.write.bind(cfgMem),
    // Stream-mode config-mem callbacks. Same backing storage as the datagram
    // path — the bridge only differs in transport, not in data.
    configMemStreamReadCallbacks: {
        configurationMemory: cfgMem.read.bind(cfgMem),
        configDescriptionInfo: (node, address, count, buffer) => {
            const cdi = node.parameters.cdi;
            if (!cdi) return 0;
            const n = Math.min(count, Math.max(0, cdi.length - address));
            buffer.set(cdi.subarray(address, address + n));
            return n;
        },
        trainFunctionDefinitionInfo: (node, address, count, buffer) => {
            const fdi = node.parameters.fdi;
            if (!fdi) return 0;
            const n = Math.min(count, Math.max(0, fdi.length - address));
            buffer.set(fdi.subarray(address, address + n));
            return n;
        },
    },
    configMemStreamWriteCallbacks: {
        configurationMemory: cfgMem.write.bind(cfgMem),
    },
    callbacks: {
        onLoginComplete: (node) => {
            log(`node ${nodeIdToString(node.id)} login complete, alias=0x${node.alias.toString(16)}`);
            return true;
        },
        onConsumedEventIdentified: (node, idx, eventId, status) => {
            log(`consumed event: 0x${eventId.toString(16).padStart(16, '0')} status=${status}`);
        },
        onPcEventReport: (node, eventId) => {
            log(`PCER received: 0x${eventId.toString(16).padStart(16, '0')}`);
        },
        onTransportConnect: () => log(`TCP server listening on 0.0.0.0:${PORT} (trace=${TRACE}) mode=${MODE}`),
        // MemCfg §4.24 Reset/Reboot datagram (0x20 0xA9): mirror the C
        // compliance node's OSxDrivers_reboot → OpenLcbNode_reset_state().
        // Flipping each node back to runState=INIT / permitted=false makes the
        // login state machine re-emit CID/RID/AMD + Initialization_Complete
        // (which serves as the implicit datagram acknowledgment).
        // Harness-side acceptance for standalone Stream Initiate Requests —
        // the checker's section 11 tests open streams directly without a
        // preceding config-mem write datagram. Config-mem write streams are
        // already auto-claimed by the library default before this runs.
        onStreamInitiateRequest: () => true,
        onResetReboot: () => {
            log('reboot requested via protocol — resetting node state');
            // resetState() wipes every node back to INIT/not-permitted, which
            // is what we want for the main target node so it re-emits its
            // Initialization_Complete (the signal check_me10_init is looking
            // for). But it also resets our train-mode virtuals, which would
            // then go through CAN+OpenLCB login and emit THEIR Init_Complete
            // frames too — racing the main node's and causing intermittent
            // check_me10_init failures because that check expects exactly one
            // Init_Complete, from the target node, after reboot.
            //
            // Re-apply the short-circuit so virtuals jump straight back to
            // RUNSTATE_RUN without re-advertising themselves. Only the main
            // node goes through the real login path on reboot. See
            // shortCircuitNodeToRun() for why this is safe in harness code.
            config.nodePool.resetState();
            if (MODE === 'train') {
                for (const anyNode of config.nodePool.getAllNodes()) {
                    if (anyNode && anyNode !== node) {
                        shortCircuitNodeToRun(config, anyNode);
                    }
                }
            }
        },
        // Train Search ALLOCATE — called on the last enumerated node when no
        // existing train matched. Pick a pre-allocated virtual train whose DCC
        // address is still 0, assign the requested address, and return it so
        // the search handler can reply on its behalf.
        onTrainSearchNoMatch: (searchAddress, flags) => {
            for (const vNode of config.nodePool.getAllNodes()) {
                if (!vNode || !vNode.trainState) continue;
                if (vNode.trainState.dccAddress !== 0) continue;
                config.applicationTrain.setDccAddress(
                    vNode, searchAddress, !!(flags & TRAIN_SEARCH_FLAG_LONG_ADDR),
                );
                log(`train search allocate: assigned DCC ${searchAddress} (${flags & TRAIN_SEARCH_FLAG_LONG_ADDR ? 'long' : 'short'}) to ${nodeIdToString(vNode.id)}`);
                return vNode;
            }
            log(`train search allocate: no free virtual train slot for DCC ${searchAddress}`);
            return null;
        },
    },
});

const node = config.createNode(NODE_ID, mode.makeParameters());
log(`allocated node ${nodeIdToString(node.id)} — ${mode.description}`);
mode.setup(config, node);

config.start();

// Emit a stable, unambiguous ready line so orchestrators (run-conformance.mjs)
// know the TCP server is listening. onTransportConnect above only fires on
// client connect, which is too late to gate the checker spawn.
log(`harness ready on port ${PORT} mode=${MODE}`);

process.on('SIGINT', () => {
    log('stopping...');
    config.stop();
    process.exit(0);
});

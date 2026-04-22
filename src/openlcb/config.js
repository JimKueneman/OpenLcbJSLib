// Central factory — wires every subsystem together and exposes the public API.
//
// Replaces OpenLcbCLib/src/openlcb/openlcb_config.c. The C version is a
// ~1200-line file that allocates every pool, every buffer, every state
// machine, and calls every `_initialize()` in the right order. The JS port
// collapses all that to DI object construction because we don't have static
// pools or compile-time flags — every module is always linked, every
// protocol handler is always instantiated, and tree-shaking is a bundler
// concern (see the plan's "No Conditional Compilation" section).
//
// Typical use:
//
//   import { OpenLcbConfig } from './src/openlcb/config.js';
//
//   const config = new OpenLcbConfig({
//       websocketUrl: 'ws://localhost:12021',
//       configMemoryRead:  (node, addr, n, buf) => { ... },
//       configMemoryWrite: (node, addr, n, buf) => { ... },
//       callbacks: { onLoginComplete: (node) => { ... } },
//   });
//
//   const node = config.createNode(0x050101010700n, nodeParameters);
//   config.start();

import {
    MTI_DATAGRAM,
    MTI_DATAGRAM_OK_REPLY,
    MTI_DATAGRAM_REJECTED_REPLY,
    MTI_STREAM_INIT_REQUEST,
    MTI_STREAM_INIT_REPLY,
    MTI_STREAM_SEND,
    MTI_STREAM_PROCEED,
    MTI_STREAM_COMPLETE,
    MTI_TERMINATE_DUE_TO_ERROR,
    MTI_PC_EVENT_REPORT,
    MTI_PC_EVENT_REPORT_WITH_PAYLOAD,
    MTI_PRODUCER_IDENTIFIED_SET,
    MTI_PRODUCER_IDENTIFY,
} from './defines.js';

// Core infrastructure
import { NodePool } from './node.js';
import { MessageFifo } from './message-fifo.js';
import { createMessage } from './types.js';

// CAN layer
import { AliasMappings } from '../drivers/can/alias-mappings.js';
import { AliasMappingListener } from '../drivers/can/alias-mapping-listener.js';
import { CanBufferFifo } from '../drivers/can/buffer-fifo.js';
import { CanLoginMessageHandler } from '../drivers/can/login-message-handler.js';
import { CanLoginStatemachine } from '../drivers/can/login-statemachine.js';
import { CanRxMessageHandler } from '../drivers/can/rx-message-handler.js';
import { CanTxMessageHandler } from '../drivers/can/tx-message-handler.js';
import { CanMainStatemachine } from '../drivers/can/main-statemachine.js';
import { CanRxStatemachine } from '../drivers/can/rx-statemachine.js';

// OpenLCB layer
import { OpenLcbLoginStatemachine } from './login-statemachine.js';
import { OpenLcbMainStatemachine } from './main-statemachine.js';

// Protocol handlers
import { ProtocolMessageNetwork } from '../protocol/message-network.js';
import { ProtocolSnip } from '../protocol/snip.js';
import { ProtocolEventTransport } from '../protocol/event-transport.js';
import { ProtocolDatagramHandler } from '../protocol/datagram-handler.js';
import { ProtocolConfigMemRead } from '../protocol/config-mem-read.js';
import { ProtocolConfigMemWrite } from '../protocol/config-mem-write.js';
import { ProtocolConfigMemOperations } from '../protocol/config-mem-operations.js';
import { ProtocolStreamHandler } from '../protocol/stream-handler.js';
import { ProtocolConfigMemStream } from '../protocol/config-mem-stream.js';
import { ProtocolTrainHandler } from '../protocol/train-handler.js';
import { ProtocolTrainSearchHandler, isSearchEvent } from '../protocol/train-search-handler.js';
import { ProtocolBroadcastTimeHandler } from '../protocol/broadcast-time-handler.js';

// Application layer
import { OpenLcbApplication } from './application.js';
import { OpenLcbApplicationTrain } from './application-train.js';
import { OpenLcbApplicationBroadcastTime } from './application-broadcast-time.js';

// Transport
import { WebSocketTransport } from '../drivers/websocket/transport.js';

// =============================================================================

export class OpenLcbConfig {
    /**
     * @param {Object} opts
     * @param {string}   opts.websocketUrl            required
     * @param {Function} [opts.WebSocketImpl]         optional ctor (test injection)
     * @param {boolean}  [opts.autoReconnect=true]
     *
     * @param {(node, address, count, buffer) => number} [opts.configMemoryRead]
     * @param {(node, address, count, buffer) => number} [opts.configMemoryWrite]
     *
     * @param {Object}   [opts.callbacks]              application callback bag
     *   onLoginComplete(node)
     *   onPcEventReport(node, eventId)
     *   onConsumedEventIdentified(node, index, eventId, status, payload)
     *   onConsumerIdentifiedUnknown/Set/Clear/Reserved(node, eventId)
     *   onProducerIdentifiedUnknown/Set/Clear/Reserved(node, eventId)
     *   onConsumerRangeIdentified(node, eventId)
     *   onProducerRangeIdentified(node, eventId)
     *   onOptionalInteractionRejected(node, sourceId, errorCode, rejectedMti)
     *   onTerminateDueToError(node, sourceId, errorCode, rejectedMti)
     *   onTrainSpeedChanged(node, speed)
     *   onTrainFunctionChanged(node, fnAddress, fnValue)
     *   onTrainEmergencyEntered/Exited(node, type)
     *   onBroadcastTimeChanged(clock), etc.
     *
     * @param {Object}   [opts.snipLoaders]             custom SNIP field loaders
     * @param {number}   [opts.aliasMappingsCapacity=16]
     * @param {number}   [opts.listenerCapacity=16]
     * @param {number}   [opts.maxConcurrentStreams=2]
     */
    constructor(opts) {
        if (!opts || (!opts.websocketUrl && !opts.transport)) {
            throw new Error('OpenLcbConfig: either websocketUrl or transport factory is required');
        }
        this._opts = opts;
        const cb = opts.callbacks ?? {};

        // ----------------------------------------------------------
        // Phase 1: build foundation pieces (no cross-references yet)
        // ----------------------------------------------------------
        this.nodePool = new NodePool({ on100msTimerTick: cb.on100msTimerTick });
        this.aliasMappings = new AliasMappings(opts.aliasMappingsCapacity ?? 16);
        this.aliasMappingListener = new AliasMappingListener({ capacity: opts.listenerCapacity ?? 16 });

        this.canTxFifo = new CanBufferFifo();
        this.openlcbRxFifo = new MessageFifo();
        this.openlcbTxFifo = new MessageFifo();

        // Current 100ms tick — updated by the internal setInterval.
        this._tick = 0;
        const getCurrentTick = () => this._tick;

        // ----------------------------------------------------------
        // CAN transport + RX pipeline
        // ----------------------------------------------------------
        // The WebSocket transport feeds raw CAN frames into the RX pipeline;
        // the TX handler writes them back out via the transport.
        const transportHandlers = {
            onCanFrame: (canMsg) => this.canRxStatemachine.handleFrame(canMsg),
            onConnect: cb.onTransportConnect,
            onDisconnect: cb.onTransportDisconnect,
            onError: cb.onTransportError,
        };
        // `opts.transport` is a factory that receives these handlers and
        // returns a transport object with connect/disconnect/send methods.
        // Default to the built-in WebSocket transport.
        this.transport = typeof opts.transport === 'function'
            ? opts.transport(transportHandlers)
            : new WebSocketTransport({
                url: opts.websocketUrl,
                WebSocketImpl: opts.WebSocketImpl,
                autoReconnect: opts.autoReconnect,
                frameTerminator: opts.frameTerminator,
                ...transportHandlers,
            });

        this.canTxMessageHandler = new CanTxMessageHandler({
            transmit: (canMsg) => this.transport.send(canMsg),
            onTransmit: cb.onCanTransmit,
        });

        // CAN RX — reassembles frames into OpenLCB messages and pushes to openlcbRxFifo.
        this.canRxMessageHandler = new CanRxMessageHandler({
            aliasMappings: this.aliasMappings,
            canTxFifo: this.canTxFifo,
            openlcbFifo: this.openlcbRxFifo,
            getCurrentTick,
            listener: this.aliasMappingListener,
        });

        this.canRxStatemachine = new CanRxStatemachine({
            rxHandler: this.canRxMessageHandler,
            aliasMappings: this.aliasMappings,
            onReceive: cb.onCanReceive,
        });

        // ----------------------------------------------------------
        // Login (CAN) and main (CAN) state machines
        // ----------------------------------------------------------
        this.canLoginHandler = new CanLoginMessageHandler({
            aliasMappings: this.aliasMappings,
            onAliasChange: cb.onAliasChange,
        });
        this.canLoginStatemachine = new CanLoginStatemachine(this.canLoginHandler);

        this.canMainStatemachine = new CanMainStatemachine({
            nodePool: this.nodePool,
            aliasMappings: this.aliasMappings,
            canTxFifo: this.canTxFifo,
            loginStatemachine: this.canLoginStatemachine,
            sendCanMessage: (canMsg) => this.canTxMessageHandler.canFrame(canMsg),
            getCurrentTick,
            listener: this.aliasMappingListener,
        });

        // ----------------------------------------------------------
        // Application layer
        // ----------------------------------------------------------
        // The OpenLCB TX path goes: message factory → segment via
        // canTxMessageHandler → WebSocket. We wire it through a
        // `sendOpenlcbMsg` closure so app and protocol layers share one path.
        const sendOpenlcbMsg = (msg) => this._sendOpenlcbMsg(msg);

        this.application = new OpenLcbApplication({
            sendOpenlcbMsg,
            configMemoryRead: opts.configMemoryRead,
            configMemoryWrite: opts.configMemoryWrite,
        });
        this.applicationTrain = new OpenLcbApplicationTrain({
            application: this.application,
            sendOpenlcbMsg,
            onHeartbeatTimeout: cb.onTrainHeartbeatTimeout,
        });
        this.applicationBroadcastTime = new OpenLcbApplicationBroadcastTime({
            application: this.application,
            sendOpenlcbMsg,
            callbacks: {
                onTimeChanged: cb.onBroadcastTimeChanged,
                onTimeReceived: cb.onBroadcastTimeReceived,
                onDateReceived: cb.onBroadcastDateReceived,
                onYearReceived: cb.onBroadcastYearReceived,
                onDateRollover: cb.onBroadcastDateRollover,
            },
        });

        // ----------------------------------------------------------
        // Protocol handlers (Phase 4/5)
        // ----------------------------------------------------------
        this.messageNetworkHandler = new ProtocolMessageNetwork({
            onOptionalInteractionRejected: cb.onOptionalInteractionRejected,
            onTerminateDueToError: cb.onTerminateDueToError,
        });
        this.snipHandler = new ProtocolSnip({ configMemoryRead: opts.configMemoryRead });
        this.eventTransport = new ProtocolEventTransport(cb);

        this.streamHandler = new ProtocolStreamHandler({
            maxConcurrentStreams: opts.maxConcurrentStreams ?? 2,
            // Default initiator hook: if a config-mem write context is pending
            // a Stream Initiate Request, bind and auto-accept. Otherwise defer
            // to the user callback (absent = reject, stream handler default).
            onInitiateRequest: (sm, stream) => {
                const ctx = this.configMemStream.claimWriteInitiate(sm, stream);
                if (ctx) return true;
                return cb.onStreamInitiateRequest
                    ? cb.onStreamInitiateRequest(sm, stream)
                    : false;
            },
            onInitiateReply:   (sm, stream) => this._streamInitiateReplyFanout(sm, stream),
            onDataReceived:    (sm, stream) => this._streamDataReceivedFanout(sm, stream),
            onDataProceed:     cb.onStreamDataProceed,
            onComplete:        (sm, stream) => this._streamCompleteFanout(sm, stream),
        });

        this.configMemStream = new ProtocolConfigMemStream({
            streamHandler: this.streamHandler,
            loadDatagramReceivedOk: (sm, s) => this.datagramHandler.loadDatagramReceivedOkMessage(sm, s),
            loadDatagramRejected:   (sm, e) => this.datagramHandler.loadDatagramRejectedMessage(sm, e),
            readCallbacks: opts.configMemStreamReadCallbacks,
            writeCallbacks: opts.configMemStreamWriteCallbacks,
        });

        this.configMemRead = new ProtocolConfigMemRead({
            loadDatagramReceivedOk: (sm, s) => this.datagramHandler.loadDatagramReceivedOkMessage(sm, s),
            loadDatagramRejected:   (sm, e) => this.datagramHandler.loadDatagramRejectedMessage(sm, e),
            configMemoryRead: opts.configMemoryRead,
            snip: opts.snipLoaders ?? this._defaultSnipLoaders(),
        });
        this.configMemWrite = new ProtocolConfigMemWrite({
            loadDatagramReceivedOk: (sm, s) => this.datagramHandler.loadDatagramReceivedOkMessage(sm, s),
            loadDatagramRejected:   (sm, e) => this.datagramHandler.loadDatagramRejectedMessage(sm, e),
            configMemoryRead: opts.configMemoryRead,
            configMemoryWrite: opts.configMemoryWrite,
        });
        this.configMemOperations = new ProtocolConfigMemOperations({
            loadDatagramReceivedOk: (sm, s) => this.datagramHandler.loadDatagramReceivedOkMessage(sm, s),
            loadDatagramRejected:   (sm, e) => this.datagramHandler.loadDatagramRejectedMessage(sm, e),
            overrides: {
                // MemCfg §4.24 restart: application-level handler flips nodes
                // back to pre-login; the login SM re-emits CID/RID/AMD and
                // Initialization_Complete serves as the implicit ACK.
                resetReboot: cb.onResetReboot ?? null,
            },
        });

        this.datagramHandler = new ProtocolDatagramHandler({
            nodePool: this.nodePool,
            callbacks: this._buildDatagramCallbackTable(),
        });

        this.trainHandler = new ProtocolTrainHandler(cb);
        this.trainSearchHandler = new ProtocolTrainSearchHandler({
            onSearchMatched: cb.onTrainSearchMatched,
            onSearchNoMatch: cb.onTrainSearchNoMatch,
        });
        this.broadcastTimeHandler = new ProtocolBroadcastTimeHandler({
            getClock:   (id) => this.applicationBroadcastTime.getClock(id),
            isProducer: (id) => this.applicationBroadcastTime.isProducer(id),
            sendReportTime: (node, id, h, m) => this.applicationBroadcastTime.sendReportTime(node, id, h, m),
            triggerSyncDelay: (id) => this.applicationBroadcastTime.triggerSyncDelay(id),
            triggerQueryReply: (id) => this.applicationBroadcastTime.triggerQueryReply(id),
            callbacks: cb,
        });

        // ----------------------------------------------------------
        // OpenLCB login + main state machines
        // ----------------------------------------------------------
        this.openlcbLoginStatemachine = new OpenLcbLoginStatemachine({
            nodePool: this.nodePool,
            sendOpenlcbMsg,
            onLoginComplete: cb.onLoginComplete ?? (() => true),
            extractProducerEventStateMti: (node, idx) =>
                ProtocolEventTransport.extractProducerEventStatusMti(node, idx),
            extractConsumerEventStateMti: (node, idx) =>
                ProtocolEventTransport.extractConsumerEventStatusMti(node, idx),
            // processMainStatemachine wired in after mainStatemachine exists (below).
        });

        this.openlcbMainStatemachine = new OpenLcbMainStatemachine({
            nodePool: this.nodePool,
            openlcbRxFifo: this.openlcbRxFifo,
            sendOpenlcbMsg,
            getCurrentTick,
            handlers: this._buildMainDispatchHandlers(cb),
            loadDatagramRejected: (sm, e) => this.datagramHandler.loadDatagramRejectedMessage(sm, e),
        });

        // Back-fill the sibling-dispatch hook on the login SM now that the main SM exists.
        this.openlcbLoginStatemachine._processMainStatemachine =
            (sibSm) => this.openlcbMainStatemachine.process(sibSm);

        // Run-loop state.
        this._running = false;
        this._rafHandle = null;
        this._tickInterval = null;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /** Allocate a virtual node and return it. Matches the plan's API sketch. */
    createNode(nodeId, parameters) {
        return this.nodePool.allocate(nodeId, parameters);
    }

    /** Connect the transport and start the main + 100ms loops. */
    start() {
        if (this._running) return;
        this._running = true;

        this.transport.connect();

        // 100ms tick — browser-native setInterval. For Node we use the same
        // timer API which is supported in both environments.
        this._tickInterval = setInterval(() => {
            this._tick = (this._tick + 1) & 0xFF;
            this.nodePool.timerTick(this._tick);
            this.applicationTrain.timerTick(this._tick);
            this.applicationBroadcastTime.timerTick(this._tick);
            this.datagramHandler.checkTimeouts(this._tick);
        }, 100);

        // Main run loop — uses requestAnimationFrame in the browser, falls
        // back to setImmediate / setTimeout in Node.
        const schedule = (typeof requestAnimationFrame !== 'undefined')
            ? (fn) => requestAnimationFrame(fn)
            : (fn) => setTimeout(fn, 0);

        // Each run() advances the state machines by a single priority-step, so
        // processing one incoming message across N nodes needs ~N+1 ticks.
        // setTimeout(0) is throttled to ~1ms in Node, which caps us at ~1000
        // steps/sec — not enough to keep up with a multi-node burst of
        // back-to-back messages (see fr50_capacity in train mode). Drain under
        // a time budget each scheduler slice instead; 5ms is imperceptible to
        // the browser (200 Hz) and still yields cleanly for Node's I/O.
        const DRAIN_BUDGET_MS = 5;
        const now = (typeof performance !== 'undefined' && performance.now)
            ? () => performance.now()
            : () => Date.now();
        const tick = () => {
            if (!this._running) return;
            const deadline = now() + DRAIN_BUDGET_MS;
            do {
                this.canMainStatemachine.run();
                this.openlcbLoginStatemachine.run();
                this.openlcbMainStatemachine.run();
                this.configMemStream.pump(this.openlcbMainStatemachine.getStateInfo());
            } while (now() < deadline);
            this._rafHandle = schedule(tick);
        };
        this._rafHandle = schedule(tick);
    }

    /** Stop the run loops and disconnect the transport. */
    stop() {
        this._running = false;
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
        this.transport.disconnect();
    }

    // -------------------------------------------------------------------------
    // Internal wiring helpers
    // -------------------------------------------------------------------------

    /**
     * Send an OpenLCB message out via the TX path. For global/addressed
     * single-frame messages we delegate directly to the CAN TX handler's
     * segmenter, walking the index until all bytes have been shipped.
     */
    _sendOpenlcbMsg(msg) {
        if (!msg) return false;
        // A scratch CAN frame for segmentation. Persistent across frames so
        // we can iterate indexRef.value through the payload.
        const worker = { state: { allocated: false }, identifier: 0, payloadCount: 0, payload: new Uint8Array(8) };
        const indexRef = { value: 0 };

        const isAddressed = (msg.mti & 0x0008) === 0x0008; // MASK_DEST_ADDRESS_PRESENT
        const mti = msg.mti;

        const isStream = mti === MTI_STREAM_SEND;

        // Iterate until all bytes sent or a frame fails (transport busy).
        // Most messages are single-frame, so the loop usually runs once.
        let safety = 0;
        while (safety++ < 64) {
            let ok;
            if (isStream) {
                ok = this.canTxMessageHandler.streamFrame(msg, worker, indexRef);
            } else if (mti === MTI_DATAGRAM) {
                ok = this.canTxMessageHandler.datagramFrame(msg, worker, indexRef);
            } else if (isAddressed) {
                ok = this.canTxMessageHandler.addressedMsgFrame(msg, worker, indexRef);
            } else {
                ok = this.canTxMessageHandler.unaddressedMsgFrame(msg, worker, indexRef);
            }
            if (!ok) return false;
            if (indexRef.value >= msg.payloadCount) return true;
        }
        return false;
    }

    _buildMainDispatchHandlers(cb) {
        const network = this.messageNetworkHandler;
        const snip = this.snipHandler;
        const events = this.eventTransport;
        const datagram = this.datagramHandler;
        const stream = this.streamHandler;
        const train = this.trainHandler;
        const broadcastTime = this.broadcastTimeHandler;
        const trainSearch = this.trainSearchHandler;

        return {
            snipSimpleNodeInfoRequest:            (sm) => snip.handleSimpleNodeInfoRequest(sm),
            snipSimpleNodeInfoReply:              (sm) => snip.handleSimpleNodeInfoReply(sm),

            messageNetworkInitializationComplete:       (sm) => network.handleInitializationComplete(sm),
            messageNetworkInitializationCompleteSimple: (sm) => network.handleInitializationCompleteSimple(sm),
            messageNetworkProtocolSupportInquiry:       (sm) => network.handleProtocolSupportInquiry(sm),
            messageNetworkProtocolSupportReply:         (sm) => network.handleProtocolSupportReply(sm),
            messageNetworkVerifyNodeIdAddressed:        (sm) => network.handleVerifyNodeIdAddressed(sm),
            messageNetworkVerifyNodeIdGlobal:           (sm) => network.handleVerifyNodeIdGlobal(sm),
            messageNetworkVerifiedNodeId:               (sm) => network.handleVerifiedNodeId(sm),
            messageNetworkOptionalInteractionRejected:  (sm) => network.handleOptionalInteractionRejected(sm),
            messageNetworkTerminateDueToError:          (sm) => {
                network.handleTerminateDueToError(sm);
                stream.handleTerminateDueToError(sm);
            },

            eventTransportConsumerIdentify:          (sm) => events.handleConsumerIdentify(sm),
            eventTransportConsumerRangeIdentified:   (sm) => events.handleConsumerRangeIdentified(sm),
            eventTransportConsumerIdentifiedUnknown: (sm) => events.handleConsumerIdentifiedUnknown(sm),
            eventTransportConsumerIdentifiedSet:     (sm) => events.handleConsumerIdentifiedSet(sm),
            eventTransportConsumerIdentifiedClear:   (sm) => events.handleConsumerIdentifiedClear(sm),
            eventTransportConsumerIdentifiedReserved:(sm) => events.handleConsumerIdentifiedReserved(sm),
            eventTransportProducerIdentify:          (sm) => {
                // Intercept train-search events before falling through.
                const eid = this._extractEventIdFromIncoming(sm);
                if (isSearchEvent(eid)) {
                    if (sm.node.trainState) {
                        trainSearch.handleSearchEvent(sm, eid);
                        if (sm.outgoing.valid) sm.trainSearchMatchFound = true;
                    }
                    // On the last enumerated node, if nothing has matched and
                    // the ALLOCATE flag is set, invoke the no-match handler to
                    // spawn/assign a virtual train and reply on its behalf.
                    if (this.nodePool.isLast(sm.enumeratorKey) &&
                        !sm.trainSearchMatchFound &&
                        !sm.outgoing.valid) {
                        trainSearch.handleSearchNoMatch(sm, eid);
                    }
                    return;
                }
                events.handleProducerIdentify(sm);
            },
            eventTransportProducerRangeIdentified:   (sm) => events.handleProducerRangeIdentified(sm),
            eventTransportProducerIdentifiedUnknown: (sm) => events.handleProducerIdentifiedUnknown(sm),
            eventTransportProducerIdentifiedSet:     (sm) => {
                const eid = this._extractEventIdFromIncoming(sm);
                // Broadcast-time Producer Identified Set is a clock sync announcement.
                if (sm.node.index === 0 && broadcastTime.isTimeEvent(eid)) {
                    broadcastTime.handleTimeEvent(sm, eid);
                    return;
                }
                events.handleProducerIdentifiedSet(sm);
            },
            eventTransportProducerIdentifiedClear:   (sm) => events.handleProducerIdentifiedClear(sm),
            eventTransportProducerIdentifiedReserved:(sm) => events.handleProducerIdentifiedReserved(sm),
            eventTransportIdentifyDest:              (sm) => events.handleEventsIdentifyDest(sm),
            eventTransportIdentify:                  (sm) => events.handleEventsIdentify(sm),
            eventTransportLearn:                     (sm) => events.handleEventLearn(sm),
            eventTransportPcReport:                  (sm) => {
                const eid = this._extractEventIdFromIncoming(sm);
                // Emergency-event intercept for train nodes.
                if (sm.node.trainState && ProtocolTrainHandler.isEmergencyEvent(eid)) {
                    train.handleEmergencyEvent(sm, eid);
                    return;
                }
                // Broadcast-time intercept on node 0.
                if (sm.node.index === 0 && broadcastTime.isTimeEvent(eid)) {
                    broadcastTime.handleTimeEvent(sm, eid);
                    return;
                }
                events.handlePcEventReport(sm);
            },
            eventTransportPcReportWithPayload:       (sm) => events.handlePcEventReportWithPayload(sm),

            trainControlCommand:             (sm) => train.handleTrainCommand(sm),
            trainControlReply:               (sm) => train.handleTrainReply(sm),
            simpleTrainNodeIdentInfoRequest: (sm) => snip.handleSimpleNodeInfoRequest(sm),  // Train uses SNIP format
            simpleTrainNodeIdentInfoReply:   (sm) => snip.handleSimpleNodeInfoReply(sm),

            datagram:              (sm) => datagram.handleDatagram(sm),
            datagramOkReply:       (sm) => datagram.handleDatagramReceivedOk(sm),
            datagramRejectedReply: (sm) => datagram.handleDatagramRejected(sm),

            streamInitiateRequest: (sm) => stream.initiateRequest(sm),
            streamInitiateReply:   (sm) => stream.initiateReply(sm),
            streamSendData:        (sm) => stream.dataSend(sm),
            streamDataProceed:     (sm) => stream.dataProceed(sm),
            streamDataComplete:    (sm) => stream.dataComplete(sm),
        };
    }

    _extractEventIdFromIncoming(sm) {
        const p = sm.incoming.msg.payload;
        return (
            (BigInt(p[0]) << 56n) | (BigInt(p[1]) << 48n) |
            (BigInt(p[2]) << 40n) | (BigInt(p[3]) << 32n) |
            (BigInt(p[4]) << 24n) | (BigInt(p[5]) << 16n) |
            (BigInt(p[6]) << 8n)  |  BigInt(p[7])
        );
    }

    _defaultSnipLoaders() {
        const snip = this.snipHandler;
        return {
            loadManufacturerVersionId: (node, msg, off, n) => snip.loadManufacturerVersionId(node, msg, off, n),
            loadName:                  (node, msg, off, n) => snip.loadName(node, msg, off, n),
            loadModel:                 (node, msg, off, n) => snip.loadModel(node, msg, off, n),
            loadHardwareVersion:       (node, msg, off, n) => snip.loadHardwareVersion(node, msg, off, n),
            loadSoftwareVersion:       (node, msg, off, n) => snip.loadSoftwareVersion(node, msg, off, n),
            loadUserVersionId:         (node, msg, off, n) => snip.loadUserVersionId(node, msg, off, n),
            loadUserName:              (node, msg, off, n) => snip.loadUserName(node, msg, off, n),
            loadUserDescription:       (node, msg, off, n) => snip.loadUserDescription(node, msg, off, n),
        };
    }

    /** Route per-address-space datagram sub-commands into config-mem-{read,write,operations}. */
    _buildDatagramCallbackTable() {
        const r = this.configMemRead;
        const w = this.configMemWrite;
        const op = this.configMemOperations;
        const s = this.configMemStream;

        return {
            // Read
            memoryReadSpaceConfigDescriptionInfo: (sm) => r.readSpaceConfigDescriptionInfo(sm),
            memoryReadSpaceAll:                   (sm) => r.readSpaceAll(sm),
            memoryReadSpaceConfigurationMemory:   (sm) => r.readSpaceConfigMemory(sm),
            memoryReadSpaceAcdiManufacturer:      (sm) => r.readSpaceAcdiManufacturer(sm),
            memoryReadSpaceAcdiUser:              (sm) => r.readSpaceAcdiUser(sm),
            memoryReadSpaceTrainFunctionDefinitionInfo: (sm) => r.readSpaceTrainFunctionDefinitionInfo(sm),
            memoryReadSpaceTrainFunctionConfigMemory:   (sm) => r.readSpaceTrainFunctionConfigMemory(sm),

            // Read stream
            memoryReadStreamSpaceConfigDescriptionInfo: (sm) => s.readStreamSpaceConfigDescriptionInfo(sm),
            memoryReadStreamSpaceAll:                   (sm) => s.readStreamSpaceAll(sm),
            memoryReadStreamSpaceConfigurationMemory:   (sm) => s.readStreamSpaceConfigMemory(sm),
            memoryReadStreamSpaceAcdiManufacturer:      (sm) => s.readStreamSpaceAcdiManufacturer(sm),
            memoryReadStreamSpaceAcdiUser:              (sm) => s.readStreamSpaceAcdiUser(sm),
            memoryReadStreamSpaceTrainFunctionDefinitionInfo: (sm) => s.readStreamSpaceTrainFunctionDefinitionInfo(sm),
            memoryReadStreamSpaceTrainFunctionConfigMemory:   (sm) => s.readStreamSpaceTrainFunctionConfigMemory(sm),

            // Write
            memoryWriteSpaceConfigDescriptionInfo: (sm) => w.writeSpaceConfigDescriptionInfo(sm),
            memoryWriteSpaceAll:                   (sm) => w.writeSpaceAll(sm),
            memoryWriteSpaceConfigurationMemory:   (sm) => w.writeSpaceConfigMemory(sm),
            memoryWriteSpaceAcdiManufacturer:      (sm) => w.writeSpaceAcdiManufacturer(sm),
            memoryWriteSpaceAcdiUser:              (sm) => w.writeSpaceAcdiUser(sm),
            memoryWriteSpaceTrainFunctionDefinitionInfo: (sm) => w.writeSpaceTrainFunctionDefinitionInfo(sm),
            memoryWriteSpaceTrainFunctionConfigMemory:   (sm) => w.writeSpaceTrainFunctionConfigMemory(sm),
            memoryWriteSpaceFirmwareUpgrade:       (sm) => w.writeSpaceFirmware(sm),

            // Write-under-mask
            memoryWriteUnderMaskSpaceConfigDescriptionInfo: (sm) => w.writeUnderMaskSpaceConfigDescriptionInfo(sm),
            memoryWriteUnderMaskSpaceAll:                   (sm) => w.writeUnderMaskSpaceAll(sm),
            memoryWriteUnderMaskSpaceConfigurationMemory:   (sm) => w.writeUnderMaskSpaceConfigMemory(sm),
            memoryWriteUnderMaskSpaceAcdiManufacturer:      (sm) => w.writeUnderMaskSpaceAcdiManufacturer(sm),
            memoryWriteUnderMaskSpaceAcdiUser:              (sm) => w.writeUnderMaskSpaceAcdiUser(sm),
            memoryWriteUnderMaskSpaceTrainFunctionDefinitionInfo: (sm) => w.writeUnderMaskSpaceTrainFunctionDefinitionInfo(sm),
            memoryWriteUnderMaskSpaceTrainFunctionConfigMemory:   (sm) => w.writeUnderMaskSpaceTrainFunctionConfigMemory(sm),
            memoryWriteUnderMaskSpaceFirmwareUpgrade:       (sm) => w.writeUnderMaskSpaceFirmware(sm),

            // Write stream
            memoryWriteStreamSpaceConfigDescriptionInfo: (sm) => s.writeStreamSpaceConfigDescriptionInfo(sm),
            memoryWriteStreamSpaceAll:                   (sm) => s.writeStreamSpaceAll(sm),
            memoryWriteStreamSpaceConfigurationMemory:   (sm) => s.writeStreamSpaceConfigMemory(sm),
            memoryWriteStreamSpaceAcdiManufacturer:      (sm) => s.writeStreamSpaceAcdiManufacturer(sm),
            memoryWriteStreamSpaceAcdiUser:              (sm) => s.writeStreamSpaceAcdiUser(sm),
            memoryWriteStreamSpaceTrainFunctionDefinitionInfo: (sm) => s.writeStreamSpaceTrainFunctionDefinitionInfo(sm),
            memoryWriteStreamSpaceTrainFunctionConfigMemory:   (sm) => s.writeStreamSpaceTrainFunctionConfigMemory(sm),
            memoryWriteStreamSpaceFirmwareUpgrade:       (sm) => s.writeStreamSpaceFirmware(sm),

            // Operations
            memoryOptions:                             (sm) => op.optionsCmd(sm),
            memoryOptionsReply:                        (sm) => op.optionsReply(sm),
            memoryGetAddressSpaceInfo:                 (sm) => op.getAddressSpaceInfo(sm),
            memoryGetAddressSpaceInfoReplyNotPresent:  (sm) => op.getAddressSpaceInfoReplyNotPresent(sm),
            memoryGetAddressSpaceInfoReplyPresent:     (sm) => op.getAddressSpaceInfoReplyPresent(sm),
            memoryReserveLock:                         (sm) => op.reserveLock(sm),
            memoryReserveLockReply:                    (sm) => op.reserveLockReply(sm),
            memoryGetUniqueId:                         (sm) => op.getUniqueId(sm),
            memoryGetUniqueIdReply:                    (sm) => op.getUniqueIdReply(sm),
            memoryUnfreeze:                            (sm) => op.unfreeze(sm),
            memoryFreeze:                              (sm) => op.freeze(sm),
            memoryUpdateComplete:                      (sm) => op.updateComplete(sm),
            memoryResetReboot:                         (sm) => op.resetReboot(sm),
            memoryFactoryReset:                        (sm) => op.factoryReset(sm),
        };
    }

    // Stream-handler fan-outs: route to both the config-mem-stream layer
    // (if it owns the stream) and the user callback.
    _streamInitiateReplyFanout(sm, stream) {
        this.configMemStream.onInitiateReply(sm, stream);
        this._opts.callbacks?.onStreamInitiateReply?.(sm, stream);
    }
    _streamDataReceivedFanout(sm, stream) {
        this.configMemStream.onDataReceived(sm, stream);
        this._opts.callbacks?.onStreamDataReceived?.(sm, stream);
    }
    _streamCompleteFanout(sm, stream) {
        this.configMemStream.onComplete(sm, stream);
        this._opts.callbacks?.onStreamComplete?.(sm, stream);
    }
}

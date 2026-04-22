// Ported from OpenLcbCLib/src/openlcb/openlcb_main_statemachine.[hc].
//
// Central MTI dispatcher. One outer `run()` iteration processes a single
// priority-chain step:
//
//   1. Send pending main outgoing message (unless in sibling dispatch).
//   2. Sibling dispatch — show the outgoing to every RUN sibling and
//      drain any replies those siblings produced.
//   3. If nothing is active, pop the next sibling response / Path B msg.
//   4. Re-enter the MTI handler when the enumerate flag is set (multi-msg).
//   5. Pop the next incoming message from the wire FIFO.
//   6. Enumerate the first node for that message.
//   7. Enumerate the next node for that message.
//
// The MTI dispatcher (`process`) dispatches by MTI to handler functions
// provided via the `handlers` dependency. Missing optional handlers are
// silently ignored for reply/indication MTIs but produce an Optional
// Interaction Rejected reply for request MTIs that need an acknowledgement.

import {
    RUNSTATE_RUN,
    MASK_DEST_ADDRESS_PRESENT,
    MTI_OPTIONAL_INTERACTION_REJECTED,
    MTI_SIMPLE_NODE_INFO_REQUEST, MTI_SIMPLE_NODE_INFO_REPLY,
    MTI_INITIALIZATION_COMPLETE, MTI_INITIALIZATION_COMPLETE_SIMPLE,
    MTI_PROTOCOL_SUPPORT_INQUIRY, MTI_PROTOCOL_SUPPORT_REPLY,
    MTI_VERIFY_NODE_ID_ADDRESSED, MTI_VERIFY_NODE_ID_GLOBAL,
    MTI_VERIFIED_NODE_ID, MTI_VERIFIED_NODE_ID_SIMPLE,
    MTI_OPTIONAL_INTERACTION_REJECTED as MTI_OIR,
    MTI_TERMINATE_DUE_TO_ERROR,
    MTI_CONSUMER_IDENTIFY, MTI_CONSUMER_RANGE_IDENTIFIED,
    MTI_CONSUMER_IDENTIFIED_UNKNOWN, MTI_CONSUMER_IDENTIFIED_SET,
    MTI_CONSUMER_IDENTIFIED_CLEAR, MTI_CONSUMER_IDENTIFIED_RESERVED,
    MTI_PRODUCER_IDENTIFY, MTI_PRODUCER_RANGE_IDENTIFIED,
    MTI_PRODUCER_IDENTIFIED_UNKNOWN, MTI_PRODUCER_IDENTIFIED_SET,
    MTI_PRODUCER_IDENTIFIED_CLEAR, MTI_PRODUCER_IDENTIFIED_RESERVED,
    MTI_EVENTS_IDENTIFY_DEST, MTI_EVENTS_IDENTIFY,
    MTI_EVENT_LEARN, MTI_PC_EVENT_REPORT, MTI_PC_EVENT_REPORT_WITH_PAYLOAD,
    MTI_TRAIN_PROTOCOL, MTI_TRAIN_REPLY,
    MTI_SIMPLE_TRAIN_INFO_REQUEST, MTI_SIMPLE_TRAIN_INFO_REPLY,
    MTI_DATAGRAM, MTI_DATAGRAM_OK_REPLY, MTI_DATAGRAM_REJECTED_REPLY,
    MTI_STREAM_INIT_REQUEST, MTI_STREAM_INIT_REPLY, MTI_STREAM_SEND,
    MTI_STREAM_PROCEED, MTI_STREAM_COMPLETE,
    ERROR_PERMANENT_NOT_IMPLEMENTED,
    ERROR_PERMANENT_NOT_IMPLEMENTED_UNKNOWN_MTI_OR_TRANPORT_PROTOCOL,
    OPENLCB_MAIN_STATMACHINE_NODE_ENUMERATOR_INDEX,
    OPENLCB_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX,
} from './defines.js';
import { PAYLOAD_TYPE, createMessage } from './types.js';
import {
    loadOpenlcbMessage,
    copyWordToPayload,
    isAddressedMessageForNode,
} from './utilities.js';

// =============================================================================
// MTI dispatch table
//   handler:  property name on the handlers object
//   onMissing:
//     'reject'  — send Optional Interaction Rejected (request MTIs)
//     'silent'  — silently ignore (reply/indication MTIs)
//     'datagramReject' — send Datagram Rejected with NOT_IMPLEMENTED
// =============================================================================

const DISPATCH = new Map([
    [MTI_SIMPLE_NODE_INFO_REQUEST,         { handler: 'snipSimpleNodeInfoRequest',     onMissing: 'reject' }],
    [MTI_SIMPLE_NODE_INFO_REPLY,           { handler: 'snipSimpleNodeInfoReply',       onMissing: 'silent' }],

    [MTI_INITIALIZATION_COMPLETE,          { handler: 'messageNetworkInitializationComplete',       onMissing: 'silent' }],
    [MTI_INITIALIZATION_COMPLETE_SIMPLE,   { handler: 'messageNetworkInitializationCompleteSimple', onMissing: 'silent' }],
    [MTI_PROTOCOL_SUPPORT_INQUIRY,         { handler: 'messageNetworkProtocolSupportInquiry',       onMissing: 'silent' }],
    [MTI_PROTOCOL_SUPPORT_REPLY,           { handler: 'messageNetworkProtocolSupportReply',         onMissing: 'silent' }],
    [MTI_VERIFY_NODE_ID_ADDRESSED,         { handler: 'messageNetworkVerifyNodeIdAddressed',        onMissing: 'silent' }],
    [MTI_VERIFY_NODE_ID_GLOBAL,            { handler: 'messageNetworkVerifyNodeIdGlobal',           onMissing: 'silent' }],
    [MTI_VERIFIED_NODE_ID,                 { handler: 'messageNetworkVerifiedNodeId',               onMissing: 'silent' }],
    [MTI_VERIFIED_NODE_ID_SIMPLE,          { handler: 'messageNetworkVerifiedNodeId',               onMissing: 'silent' }],
    [MTI_OIR,                              { handler: 'messageNetworkOptionalInteractionRejected',  onMissing: 'silent' }],
    [MTI_TERMINATE_DUE_TO_ERROR,           { handler: 'messageNetworkTerminateDueToError',          onMissing: 'silent' }],

    [MTI_CONSUMER_IDENTIFY,                { handler: 'eventTransportConsumerIdentify',             onMissing: 'silent' }],
    [MTI_CONSUMER_RANGE_IDENTIFIED,        { handler: 'eventTransportConsumerRangeIdentified',      onMissing: 'silent' }],
    [MTI_CONSUMER_IDENTIFIED_UNKNOWN,      { handler: 'eventTransportConsumerIdentifiedUnknown',    onMissing: 'silent' }],
    [MTI_CONSUMER_IDENTIFIED_SET,          { handler: 'eventTransportConsumerIdentifiedSet',        onMissing: 'silent' }],
    [MTI_CONSUMER_IDENTIFIED_CLEAR,        { handler: 'eventTransportConsumerIdentifiedClear',      onMissing: 'silent' }],
    [MTI_CONSUMER_IDENTIFIED_RESERVED,     { handler: 'eventTransportConsumerIdentifiedReserved',   onMissing: 'silent' }],
    [MTI_PRODUCER_IDENTIFY,                { handler: 'eventTransportProducerIdentify',             onMissing: 'silent' }],
    [MTI_PRODUCER_RANGE_IDENTIFIED,        { handler: 'eventTransportProducerRangeIdentified',      onMissing: 'silent' }],
    [MTI_PRODUCER_IDENTIFIED_UNKNOWN,      { handler: 'eventTransportProducerIdentifiedUnknown',    onMissing: 'silent' }],
    [MTI_PRODUCER_IDENTIFIED_SET,          { handler: 'eventTransportProducerIdentifiedSet',        onMissing: 'silent' }],
    [MTI_PRODUCER_IDENTIFIED_CLEAR,        { handler: 'eventTransportProducerIdentifiedClear',      onMissing: 'silent' }],
    [MTI_PRODUCER_IDENTIFIED_RESERVED,     { handler: 'eventTransportProducerIdentifiedReserved',   onMissing: 'silent' }],
    [MTI_EVENTS_IDENTIFY_DEST,             { handler: 'eventTransportIdentifyDest',                 onMissing: 'silent' }],
    [MTI_EVENTS_IDENTIFY,                  { handler: 'eventTransportIdentify',                     onMissing: 'silent' }],
    [MTI_EVENT_LEARN,                      { handler: 'eventTransportLearn',                        onMissing: 'silent' }],
    [MTI_PC_EVENT_REPORT,                  { handler: 'eventTransportPcReport',                     onMissing: 'silent' }],
    [MTI_PC_EVENT_REPORT_WITH_PAYLOAD,     { handler: 'eventTransportPcReportWithPayload',          onMissing: 'silent' }],

    [MTI_TRAIN_PROTOCOL,                   { handler: 'trainControlCommand',                        onMissing: 'reject' }],
    [MTI_TRAIN_REPLY,                      { handler: 'trainControlReply',                          onMissing: 'silent' }],
    [MTI_SIMPLE_TRAIN_INFO_REQUEST,        { handler: 'simpleTrainNodeIdentInfoRequest',            onMissing: 'reject' }],
    [MTI_SIMPLE_TRAIN_INFO_REPLY,          { handler: 'simpleTrainNodeIdentInfoReply',              onMissing: 'silent' }],

    [MTI_DATAGRAM,                         { handler: 'datagram',                                   onMissing: 'datagramReject' }],
    [MTI_DATAGRAM_OK_REPLY,                { handler: 'datagramOkReply',                            onMissing: 'silent' }],
    [MTI_DATAGRAM_REJECTED_REPLY,          { handler: 'datagramRejectedReply',                      onMissing: 'silent' }],

    [MTI_STREAM_INIT_REQUEST,              { handler: 'streamInitiateRequest',                      onMissing: 'reject' }],
    [MTI_STREAM_INIT_REPLY,                { handler: 'streamInitiateReply',                        onMissing: 'silent' }],
    [MTI_STREAM_SEND,                      { handler: 'streamSendData',                             onMissing: 'reject' }],
    [MTI_STREAM_PROCEED,                   { handler: 'streamDataProceed',                          onMissing: 'silent' }],
    [MTI_STREAM_COMPLETE,                  { handler: 'streamDataComplete',                         onMissing: 'reject' }],
]);

// =============================================================================
// OpenLcbMainStatemachine
// =============================================================================

export class OpenLcbMainStatemachine {
    /**
     * @param {Object} deps
     * @param {NodePool}   deps.nodePool        required
     * @param {MessageFifo} deps.openlcbRxFifo  required — incoming OpenLCB FIFO
     * @param {(msg) => boolean} deps.sendOpenlcbMsg required — wire TX callback
     * @param {() => number}     deps.getCurrentTick required — 100ms tick
     * @param {Object}           deps.handlers       required — MTI callbacks (see DISPATCH)
     * @param {(sm) => void}     [deps.loadInteractionRejected]
     *        Optional custom reject builder (falls back to the internal one
     *        which writes UNKNOWN_MTI into the standard OIR format).
     * @param {(sm, errorCode) => void} [deps.loadDatagramRejected]
     *        Required only if any datagram handler is wired up.
     */
    constructor(deps) {
        this._nodePool = deps.nodePool;
        this._openlcbRxFifo = deps.openlcbRxFifo;
        this._sendOpenlcbMsg = deps.sendOpenlcbMsg;
        this._getCurrentTick = deps.getCurrentTick;
        this._handlers = deps.handlers;
        this._customReject = deps.loadInteractionRejected ?? null;
        this._loadDatagramRejected = deps.loadDatagramRejected ?? null;

        // Main context (mirror of C _statemachine_info).
        this._sm = {
            node: null,
            incoming: { msg: null, enumerate: false },
            outgoing: {
                msg: createMessage({ payloadType: PAYLOAD_TYPE.WORKER }),
                valid: false,
                enumerate: false,
            },
            currentTick: 0,
            enumeratorKey: OPENLCB_MAIN_STATMACHINE_NODE_ENUMERATOR_INDEX,
            trainSearchMatchFound: false,
        };
        this._sm.outgoing.msg.state.allocated = true;

        // Sibling context (mirror of C _sibling_statemachine_info).
        this._sib = {
            node: null,
            incoming: { msg: null, enumerate: false },
            outgoing: {
                msg: createMessage({ payloadType: PAYLOAD_TYPE.WORKER }),
                valid: false,
                enumerate: false,
            },
            currentTick: 0,
            enumeratorKey: OPENLCB_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX,
            trainSearchMatchFound: false,
        };
        this._sib.outgoing.msg.state.allocated = true;
        this._siblingActive = false;

        // FIFO of sibling-generated responses queued while sibling dispatch runs.
        this._siblingResponseQueue = [];
    }

    /** Access internal state for tests/debug. */
    getStateInfo()         { return this._sm; }
    getSiblingStateInfo()  { return this._sib; }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    _defaultLoadInteractionRejected(sm) {
        if (!sm || !sm.node || !sm.incoming.msg || !sm.outgoing.msg) return;
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_OPTIONAL_INTERACTION_REJECTED
        );
        copyWordToPayload(sm.outgoing.msg, ERROR_PERMANENT_NOT_IMPLEMENTED_UNKNOWN_MTI_OR_TRANPORT_PROTOCOL, 0);
        copyWordToPayload(sm.outgoing.msg, sm.incoming.msg.mti, 2);
        sm.outgoing.valid = true;
    }

    _loadInteractionRejected(sm) {
        (this._customReject ?? this._defaultLoadInteractionRejected.bind(this))(sm);
    }

    /**
     * Return true when the node should process the incoming message.
     * Global messages pass through; addressed messages need an alias or ID
     * match. Verify Node ID Global is always accepted. Nodes must be
     * initialized to see wire traffic. Loopback copies skip their source.
     */
    doesNodeProcessMsg(sm) {
        if (!sm.node || !sm.incoming.msg) return false;

        if (sm.incoming.msg.state.loopback && sm.node.id === sm.incoming.msg.sourceId) {
            return false;
        }

        if (!sm.node.state.initialized) return false;

        const isAddressed = (sm.incoming.msg.mti & MASK_DEST_ADDRESS_PRESENT) === MASK_DEST_ADDRESS_PRESENT;
        if (!isAddressed) return true;

        if (sm.node.alias === sm.incoming.msg.destAlias || sm.node.id === sm.incoming.msg.destId) {
            return true;
        }

        return sm.incoming.msg.mti === MTI_VERIFY_NODE_ID_GLOBAL;
    }

    // -------------------------------------------------------------------------
    // MTI dispatch — the core switch
    // -------------------------------------------------------------------------

    process(sm) {
        if (!sm || !this.doesNodeProcessMsg(sm)) return;

        const entry = DISPATCH.get(sm.incoming.msg.mti);
        if (!entry) {
            // Reject unknown addressed MTIs, ignore unknown global ones.
            if (isAddressedMessageForNode(sm.node, sm.incoming.msg)) {
                this._loadInteractionRejected(sm);
            }
            return;
        }

        const fn = this._handlers[entry.handler];
        if (fn) {
            fn(sm);
            return;
        }

        // Missing handler — decide based on MTI class.
        switch (entry.onMissing) {
            case 'reject':
                this._loadInteractionRejected(sm);
                return;
            case 'datagramReject':
                if (this._loadDatagramRejected) {
                    this._loadDatagramRejected(sm, ERROR_PERMANENT_NOT_IMPLEMENTED);
                }
                return;
            case 'silent':
            default:
                return;
        }
    }

    // -------------------------------------------------------------------------
    // Run-loop handlers
    // -------------------------------------------------------------------------

    _handleOutgoing() {
        if (!this._sm.outgoing.valid) return false;

        if (this._sendOpenlcbMsg(this._sm.outgoing.msg)) {
            if (!this._siblingDispatchBegin()) {
                this._sm.outgoing.valid = false;
            }
        }
        return true;
    }

    _handleTryReenumerate() {
        if (this._sm.incoming.enumerate) {
            this.process(this._sm);
            return true;
        }
        return false;
    }

    _handleTryPopNextIncoming() {
        if (this._sm.incoming.msg) return false;

        const next = this._openlcbRxFifo.pop();
        this._sm.incoming.msg = next;

        if (next && next.state.invalid) {
            // Discard invalidated message (sender's alias was released).
            this._sm.incoming.msg = null;
            return true;
        }

        this._sm.currentTick = this._getCurrentTick();
        return !next; // true only if FIFO was empty (done for this tick)
    }

    _freeIncomingMessage(sm) {
        sm.incoming.msg = null;
        sm.incoming.enumerate = false;
        sm.node = null;
        sm.trainSearchMatchFound = false;
    }

    _handleTryEnumerateFirstNode() {
        if (this._sm.node) return false;

        this._sm.node = this._nodePool.getFirst(OPENLCB_MAIN_STATMACHINE_NODE_ENUMERATOR_INDEX);
        if (!this._sm.node) {
            this._freeIncomingMessage(this._sm);
            return true;
        }
        if (this._sm.node.state.runState === RUNSTATE_RUN) {
            this.process(this._sm);
        }
        return true;
    }

    _handleTryEnumerateNextNode() {
        if (!this._sm.node) return false;

        this._sm.node = this._nodePool.getNext(OPENLCB_MAIN_STATMACHINE_NODE_ENUMERATOR_INDEX);
        if (!this._sm.node) {
            this._freeIncomingMessage(this._sm);
            return true;
        }
        if (this._sm.node.state.runState === RUNSTATE_RUN) {
            this.process(this._sm);
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // Sibling dispatch
    // -------------------------------------------------------------------------

    _siblingDispatchBegin() {
        if (this._nodePool.getCount() <= 1) return false;

        this._sib.incoming.msg = this._sm.outgoing.msg;
        this._sib.incoming.enumerate = false;
        this._sib.incoming.msg.state.loopback = true;
        this._sib.trainSearchMatchFound = false;

        this._sib.node = this._nodePool.getFirst(OPENLCB_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX);
        this._siblingActive = true;
        return true;
    }

    _siblingHandleOutgoing() {
        if (this._sib.outgoing.valid) {
            if (this._sendOpenlcbMsg(this._sib.outgoing.msg)) {
                this._sib.outgoing.valid = false;
            }
            return true;
        }
        return false;
    }

    _siblingHandleReenumerate() {
        if (this._sib.incoming.enumerate) {
            this.process(this._sib);
            return true;
        }
        return false;
    }

    _siblingDispatchCurrent() {
        if (!this._sib.node) {
            this._siblingActive = false;
            return false;
        }
        if (this._sib.node.state.runState === RUNSTATE_RUN) {
            this.process(this._sib);
        }
        return true;
    }

    _siblingAdvance() {
        if (!this._sib.node) return false;
        this._sib.node = this._nodePool.getNext(OPENLCB_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX);
        if (!this._sib.node) {
            this._siblingActive = false;
            this._sib.incoming.msg = null;
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // Send with sibling dispatch — wrapper for login-statemachine / apps
    // -------------------------------------------------------------------------

    /**
     * Send `msg` to the wire and, if we have multiple virtual nodes, queue it
     * into the sibling dispatch path so other virtual nodes see it too.
     */
    sendWithSiblingDispatch(msg) {
        if (!this._sendOpenlcbMsg(msg)) return false;
        if (this._nodePool.getCount() <= 1) return true;

        // Clone the message into the sibling response queue (the main
        // outgoing slot may be reused before the sibling pass runs).
        const copy = createMessage({ payloadType: PAYLOAD_TYPE.WORKER });
        copy.mti = msg.mti;
        copy.sourceAlias = msg.sourceAlias;
        copy.sourceId = msg.sourceId;
        copy.destAlias = msg.destAlias;
        copy.destId = msg.destId;
        copy.payloadCount = msg.payloadCount;
        copy.state.loopback = true;
        for (let i = 0; i < msg.payloadCount; i++) copy.payload[i] = msg.payload[i];
        this._siblingResponseQueue.push(copy);
        return true;
    }

    // -------------------------------------------------------------------------
    // Main-loop iteration
    // -------------------------------------------------------------------------

    run() {
        // Priority 1: send main outgoing.
        if (!this._siblingActive) {
            if (this._handleOutgoing()) return;
        }

        // Priority 2: sibling dispatch steps.
        if (this._siblingActive) {
            if (this._siblingHandleOutgoing()) return;
            if (this._siblingHandleReenumerate()) return;
            if (this._siblingDispatchCurrent()) {
                this._siblingAdvance();
                if (!this._siblingActive) {
                    this._sm.outgoing.msg.state.loopback = false;
                    this._sm.outgoing.valid = false;
                }
                return;
            }
        }

        // Priority 2.5: sibling response queue.
        if (!this._siblingActive && this._siblingResponseQueue.length > 0) {
            const queued = this._siblingResponseQueue.shift();
            this._sib.incoming.msg = queued;
            this._sib.incoming.enumerate = false;
            this._sib.trainSearchMatchFound = false;
            this._sib.node = this._nodePool.getFirst(OPENLCB_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX);
            this._siblingActive = true;
            return;
        }

        // Priority 3: re-enter MTI handler for multi-message responses.
        if (this._handleTryReenumerate()) return;

        // Priority 4: pop next incoming.
        if (this._handleTryPopNextIncoming()) return;

        // Priority 5/6: enumerate first / next node.
        if (this._handleTryEnumerateFirstNode()) return;
        if (this._handleTryEnumerateNextNode()) return;
    }
}

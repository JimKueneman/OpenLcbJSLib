// Ported from OpenLcbCLib/src/openlcb/openlcb_login_statemachine.[hc]
// merged with openlcb_login_statemachine_handler.[hc].
//
// The OpenLCB-layer login sequence — picks up after the CAN login has
// completed (alias permitted, AMD sent). Runs each node through:
//
//   LOAD_INITIALIZATION_COMPLETE
//     -> LOAD_PRODUCER_EVENTS (enumerate until exhausted)
//     -> LOAD_CONSUMER_EVENTS (enumerate until exhausted)
//     -> LOGIN_COMPLETE (fire on_login_complete callback)
//     -> RUN
//
// Sibling dispatch of login messages to already-RUN virtual nodes follows
// the same pattern as the C port. Hook `processMainStatemachine` is optional
// and wired up in Phase 4 when the MTI dispatcher exists.

import {
    RUNSTATE_LOAD_INITIALIZATION_COMPLETE,
    RUNSTATE_LOAD_PRODUCER_EVENTS,
    RUNSTATE_LOAD_CONSUMER_EVENTS,
    RUNSTATE_LOGIN_COMPLETE,
    RUNSTATE_RUN,
    MTI_INITIALIZATION_COMPLETE,
    MTI_INITIALIZATION_COMPLETE_SIMPLE,
    MTI_PRODUCER_RANGE_IDENTIFIED,
    MTI_PRODUCER_IDENTIFIED_UNKNOWN,
    MTI_CONSUMER_RANGE_IDENTIFIED,
    MTI_CONSUMER_IDENTIFIED_UNKNOWN,
    PSI_SIMPLE,
    NULL_NODE_ID,
    OPENLCB_LOGIN_STATMACHINE_NODE_ENUMERATOR_INDEX,
    OPENLCB_LOGIN_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX,
} from './defines.js';
import { PAYLOAD_TYPE, createMessage } from './types.js';
import {
    loadOpenlcbMessage,
    copyNodeIdToPayload,
    copyEventIdToPayload,
    generateEventRangeId,
} from './utilities.js';

// =============================================================================
// Builders — ported from openlcb_login_statemachine_handler.c
// =============================================================================

/**
 * State handler: Initialization Complete. Picks the full or simple MTI
 * based on PSI_SIMPLE, fills the Node ID payload, primes the producer
 * enumerator, and transitions to LOAD_PRODUCER_EVENTS.
 */
function loadInitializationComplete(stateInfo) {
    const node = stateInfo.node;
    const mti = (node.parameters && (node.parameters.protocolSupport & PSI_SIMPLE))
        ? MTI_INITIALIZATION_COMPLETE_SIMPLE
        : MTI_INITIALIZATION_COMPLETE;

    loadOpenlcbMessage(stateInfo.outgoing.msg, node.alias, node.id, 0, 0n, mti);
    copyNodeIdToPayload(stateInfo.outgoing.msg, node.id, 0);
    stateInfo.outgoing.msg.payloadCount = 6;

    node.state.initialized = true;
    node.producers.enumerator.running = true;
    node.producers.enumerator.enumIndex = 0;
    node.producers.enumerator.rangeEnumIndex = 0;
    node.consumers.enumerator.running = false;
    node.consumers.enumerator.enumIndex = 0;
    node.consumers.enumerator.rangeEnumIndex = 0;

    stateInfo.outgoing.valid = true;
    node.state.runState = RUNSTATE_LOAD_PRODUCER_EVENTS;
}

/**
 * Emit one Producer Identified (or Range Identified) message, setting
 * `enumerate` so the dispatcher re-enters until the enumerator runs out.
 * The per-event state → MTI mapping is deferred to `extractProducerEventStateMti`
 * (defaulting to PRODUCER_IDENTIFIED_UNKNOWN).
 */
function loadProducerEvent(stateInfo, extractEventMti) {
    const node = stateInfo.node;

    if (node.producers.count === 0 && node.producers.rangeCount === 0) {
        node.producers.enumerator.running = false;
        node.state.runState = RUNSTATE_LOAD_CONSUMER_EVENTS;
        stateInfo.outgoing.valid = false;
        return;
    }

    // Ranges first.
    if (node.producers.enumerator.rangeEnumIndex < node.producers.rangeCount) {
        loadOpenlcbMessage(stateInfo.outgoing.msg, node.alias, node.id, 0, 0n, MTI_PRODUCER_RANGE_IDENTIFIED);
        const range = node.producers.rangeList[node.producers.enumerator.rangeEnumIndex];
        const eventId = generateEventRangeId(range.startBase, range.eventCount);
        copyEventIdToPayload(stateInfo.outgoing.msg, eventId);
        node.producers.enumerator.rangeEnumIndex++;
        stateInfo.outgoing.enumerate = true;
        stateInfo.outgoing.valid = true;
        return;
    }

    // Individual events.
    if (node.producers.enumerator.enumIndex < node.producers.count) {
        const idx = node.producers.enumerator.enumIndex;
        const eventMti = extractEventMti ? extractEventMti(node, idx) : MTI_PRODUCER_IDENTIFIED_UNKNOWN;
        const eventId = node.producers.list[idx].event;

        loadOpenlcbMessage(stateInfo.outgoing.msg, node.alias, node.id, 0, 0n, eventMti);
        copyEventIdToPayload(stateInfo.outgoing.msg, eventId);

        node.producers.enumerator.enumIndex++;
        stateInfo.outgoing.enumerate = true;
        stateInfo.outgoing.valid = true;
        return;
    }

    // Done with producers — prime consumer enumerator.
    node.producers.enumerator.enumIndex = 0;
    node.producers.enumerator.rangeEnumIndex = 0;
    node.producers.enumerator.running = false;
    node.consumers.enumerator.enumIndex = 0;
    node.consumers.enumerator.rangeEnumIndex = 0;
    node.consumers.enumerator.running = true;

    stateInfo.outgoing.enumerate = false;
    stateInfo.outgoing.valid = false;
    node.state.runState = RUNSTATE_LOAD_CONSUMER_EVENTS;
}

function loadConsumerEvent(stateInfo, extractEventMti) {
    const node = stateInfo.node;

    if (node.consumers.count === 0 && node.consumers.rangeCount === 0) {
        node.consumers.enumerator.running = false;
        node.state.runState = RUNSTATE_LOGIN_COMPLETE;
        stateInfo.outgoing.valid = false;
        return;
    }

    if (node.consumers.enumerator.rangeEnumIndex < node.consumers.rangeCount) {
        loadOpenlcbMessage(stateInfo.outgoing.msg, node.alias, node.id, 0, 0n, MTI_CONSUMER_RANGE_IDENTIFIED);
        const range = node.consumers.rangeList[node.consumers.enumerator.rangeEnumIndex];
        const eventId = generateEventRangeId(range.startBase, range.eventCount);
        copyEventIdToPayload(stateInfo.outgoing.msg, eventId);
        node.consumers.enumerator.rangeEnumIndex++;
        stateInfo.outgoing.enumerate = true;
        stateInfo.outgoing.valid = true;
        return;
    }

    if (node.consumers.enumerator.enumIndex < node.consumers.count) {
        const idx = node.consumers.enumerator.enumIndex;
        const eventMti = extractEventMti ? extractEventMti(node, idx) : MTI_CONSUMER_IDENTIFIED_UNKNOWN;
        const eventId = node.consumers.list[idx].event;

        loadOpenlcbMessage(stateInfo.outgoing.msg, node.alias, node.id, 0, 0n, eventMti);
        copyEventIdToPayload(stateInfo.outgoing.msg, eventId);

        node.consumers.enumerator.enumIndex++;
        stateInfo.outgoing.enumerate = true;
        stateInfo.outgoing.valid = true;
        return;
    }

    // Done — reset enumerators and transition.
    node.producers.enumerator.enumIndex = 0;
    node.producers.enumerator.rangeEnumIndex = 0;
    node.producers.enumerator.running = false;
    node.consumers.enumerator.enumIndex = 0;
    node.consumers.enumerator.rangeEnumIndex = 0;
    node.consumers.enumerator.running = false;

    stateInfo.outgoing.enumerate = false;
    stateInfo.outgoing.valid = false;
    node.state.runState = RUNSTATE_LOGIN_COMPLETE;
}

// =============================================================================
// Statemachine class
// =============================================================================

export class OpenLcbLoginStatemachine {
    /**
     * @param {Object} deps
     * @param {NodePool}   deps.nodePool          required
     * @param {(msg) => boolean} deps.sendOpenlcbMsg required — TX callback
     * @param {(node) => boolean} [deps.onLoginComplete] optional gate before RUN
     * @param {(node, index) => number} [deps.extractProducerEventStateMti]
     *        optional — default PRODUCER_IDENTIFIED_UNKNOWN
     * @param {(node, index) => number} [deps.extractConsumerEventStateMti]
     *        optional — default CONSUMER_IDENTIFIED_UNKNOWN
     * @param {(statemachineInfo) => void} [deps.processMainStatemachine]
     *        optional — the main MTI dispatcher (Phase 4). Wired up for
     *        sibling dispatch of login messages to local virtual nodes.
     */
    constructor(deps) {
        this._nodePool = deps.nodePool;
        this._sendOpenlcbMsg = deps.sendOpenlcbMsg;
        this._onLoginComplete = deps.onLoginComplete ?? null;
        this._extractProducerMti = deps.extractProducerEventStateMti ?? null;
        this._extractConsumerMti = deps.extractConsumerEventStateMti ?? null;
        this._processMainStatemachine = deps.processMainStatemachine ?? null;

        // Main login context — equivalent to _statemachine_info in C.
        this._stateInfo = {
            node: null,
            outgoing: {
                msg: createMessage({ payloadType: PAYLOAD_TYPE.BASIC }),
                valid: false,
                enumerate: false,
            },
        };
        this._stateInfo.outgoing.msg.state.allocated = true;

        // Sibling dispatch context — uses WORKER payload so any handler's
        // reply (up to 256 bytes) fits. Matches the C port's split context.
        this._sibling = {
            node: null,
            incoming: { msg: null, enumerate: false },
            outgoing: {
                msg: createMessage({ payloadType: PAYLOAD_TYPE.WORKER }),
                valid: false,
                enumerate: false,
            },
            active: false,
            currentTick: 0,
        };
        this._sibling.outgoing.msg.state.allocated = true;
    }

    /** Access internal state (tests/debug). Do not mutate. */
    getStateInfo() { return this._stateInfo; }

    // -------------------------------------------------------------------------
    // State dispatch
    // -------------------------------------------------------------------------

    /** Dispatch to the handler matching node.state.runState. */
    process(stateInfo) {
        switch (stateInfo.node.state.runState) {
            case RUNSTATE_LOAD_INITIALIZATION_COMPLETE:
                return loadInitializationComplete(stateInfo);
            case RUNSTATE_LOAD_CONSUMER_EVENTS:
                return loadConsumerEvent(stateInfo, this._extractConsumerMti);
            case RUNSTATE_LOAD_PRODUCER_EVENTS:
                return loadProducerEvent(stateInfo, this._extractProducerMti);
            case RUNSTATE_LOGIN_COMPLETE:
                if (this._onLoginComplete && !this._onLoginComplete(stateInfo.node)) return;
                stateInfo.node.state.runState = RUNSTATE_RUN;
                return;
            default:
                return;
        }
    }

    // -------------------------------------------------------------------------
    // Main-loop iteration
    // -------------------------------------------------------------------------

    run() {
        // 1. Send the pending login outgoing — unless held for sibling dispatch.
        if (!this._sibling.active) {
            if (this._handleOutgoing()) return;
        }

        // 2. Sibling dispatch of the outgoing login message.
        if (this._sibling.active) {
            if (this._siblingHandleOutgoing()) return;
            if (this._siblingHandleReenumerate()) return;
            if (this._siblingDispatchCurrent()) {
                this._siblingAdvance();
                if (!this._sibling.active) {
                    this._stateInfo.outgoing.msg.state.loopback = false;
                    this._stateInfo.outgoing.valid = false;
                }
                return;
            }
        }

        // 3. Re-enter the state handler for multi-message enumerate sequences.
        if (this._handleTryReenumerate()) return;

        // 4. Start enumeration at the first node.
        if (this._handleTryEnumerateFirstNode()) return;

        // 5. Advance to the next node.
        if (this._handleTryEnumerateNextNode()) return;
    }

    // -------------------------------------------------------------------------
    // Main-context helpers (public for unit tests)
    // -------------------------------------------------------------------------

    handleOutgoingOpenlcbMessage() { return this._handleOutgoing(); }
    _handleOutgoing() {
        if (!this._stateInfo.outgoing.valid) return false;

        if (this._sendOpenlcbMsg(this._stateInfo.outgoing.msg)) {
            if (!this._siblingDispatchBegin()) {
                this._stateInfo.outgoing.valid = false;
            }
        }
        return true; // keep retrying until sent
    }

    handleTryReenumerate() { return this._handleTryReenumerate(); }
    _handleTryReenumerate() {
        if (this._stateInfo.outgoing.enumerate) {
            this.process(this._stateInfo);
            return true;
        }
        return false;
    }

    handleTryEnumerateFirstNode() { return this._handleTryEnumerateFirstNode(); }
    _handleTryEnumerateFirstNode() {
        if (this._stateInfo.node) return false;

        this._stateInfo.node = this._nodePool.getFirst(OPENLCB_LOGIN_STATMACHINE_NODE_ENUMERATOR_INDEX);
        if (!this._stateInfo.node) return true;

        if (this._stateInfo.node.state.runState < RUNSTATE_RUN) {
            this.process(this._stateInfo);
        }
        return true;
    }

    handleTryEnumerateNextNode() { return this._handleTryEnumerateNextNode(); }
    _handleTryEnumerateNextNode() {
        if (!this._stateInfo.node) return false;

        this._stateInfo.node = this._nodePool.getNext(OPENLCB_LOGIN_STATMACHINE_NODE_ENUMERATOR_INDEX);
        if (!this._stateInfo.node) return true;

        if (this._stateInfo.node.state.runState < RUNSTATE_RUN) {
            this.process(this._stateInfo);
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // Sibling dispatch (optional — only meaningful when multiple virtual nodes
    // exist and the main MTI dispatcher has been wired in)
    // -------------------------------------------------------------------------

    _siblingDispatchBegin() {
        if (this._nodePool.getCount() <= 1) return false;
        if (!this._processMainStatemachine) return false;

        this._sibling.incoming.msg = this._stateInfo.outgoing.msg;
        this._sibling.incoming.enumerate = false;
        this._sibling.incoming.msg.state.loopback = true;
        this._sibling.node = this._nodePool.getFirst(OPENLCB_LOGIN_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX);
        this._sibling.active = true;
        return true;
    }

    _siblingHandleOutgoing() {
        if (this._sibling.outgoing.valid) {
            if (this._sendOpenlcbMsg(this._sibling.outgoing.msg)) {
                this._sibling.outgoing.valid = false;
            }
            return true;
        }
        return false;
    }

    _siblingHandleReenumerate() {
        if (this._sibling.incoming.enumerate) {
            this._processMainStatemachine(this._sibling);
            return true;
        }
        return false;
    }

    _siblingDispatchCurrent() {
        if (!this._sibling.node) {
            this._sibling.active = false;
            return false;
        }
        if (this._sibling.node.state.runState === RUNSTATE_RUN) {
            this._processMainStatemachine(this._sibling);
        }
        return true;
    }

    _siblingAdvance() {
        if (!this._sibling.node) return false;

        this._sibling.node = this._nodePool.getNext(OPENLCB_LOGIN_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX);
        if (!this._sibling.node) {
            this._sibling.active = false;
            this._sibling.incoming.msg = null;
        }
        return true;
    }
}

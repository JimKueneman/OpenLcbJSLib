// OpenLcbNode — per-node handle.  Wraps a 48-bit OpenLCB node ID with
// methods for sending events, registering consumers/producers, and
// namespaced sub-protocols (train, broadcastTime).
//
// Users never construct this directly; it is returned by
// openlcb.createNode().

import {
    errorForReturnCode,
    ProtocolNotSupportedError,
    PoolFullError,
} from './errors.js';
import { PSI } from './constants.js';
import { resolveParameters } from './internals/params.js';

// ---------------------------------------------------------------------------
// Sub-protocol facades — narrow classes attached to each node.
// Throw ProtocolNotSupportedError if the node did not opt in.
// ---------------------------------------------------------------------------

class TrainFacade {
    constructor(node, api) {
        this._node = node;
        this._api = api;
    }

    /** Throws if the LOCAL node isn't configured as a train (Group B methods). */
    _checkIsTrain() {
        if (!(this._node.parameters.protocolSupport & BigInt(PSI.TRAIN_CONTROL))) {
            throw new ProtocolNotSupportedError(
                'this method requires the local node to declare PSI.TRAIN_CONTROL — ' +
                'throttle-side sends (Group A) work without it; only train-side ' +
                'state setters and sendSearchMatch (Group B) require it',
            );
        }
    }

    // --- Group A: Throttle-side commands (send to remote train) -------------
    // No PSI.TRAIN_CONTROL check on the local node — a throttle issuing
    // commands to a remote train is not itself a train.

    sendAssignController(trainAlias, trainId) {
        _throwIfError(
            this._api.tAssign(this._node.id, trainAlias | 0, BigInt(trainId)),
            'train.sendAssignController',
        );
    }
    sendReleaseController(trainAlias, trainId) {
        _throwIfError(
            this._api.tRelease(this._node.id, trainAlias | 0, BigInt(trainId)),
            'train.sendReleaseController',
        );
    }
    sendEmergencyStop(trainAlias, trainId) {
        _throwIfError(
            this._api.tEstop(this._node.id, trainAlias | 0, BigInt(trainId)),
            'train.sendEmergencyStop',
        );
    }
    sendQuerySpeeds(trainAlias, trainId) {
        _throwIfError(
            this._api.tQSpeeds(this._node.id, trainAlias | 0, BigInt(trainId)),
            'train.sendQuerySpeeds',
        );
    }
    sendNoop(trainAlias, trainId) {
        _throwIfError(
            this._api.tNoop(this._node.id, trainAlias | 0, BigInt(trainId)),
            'train.sendNoop',
        );
    }
    sendSetSpeed(trainAlias, trainId, speedF16) {
        _throwIfError(
            this._api.tSetSpeed(this._node.id, trainAlias | 0, BigInt(trainId), speedF16 | 0),
            'train.sendSetSpeed',
        );
    }
    sendSetFunction(trainAlias, trainId, fnAddress, fnValue) {
        _throwIfError(
            this._api.tSetFunction(this._node.id, trainAlias | 0, BigInt(trainId), fnAddress >>> 0, fnValue | 0),
            'train.sendSetFunction',
        );
    }
    sendQueryFunction(trainAlias, trainId, fnAddress) {
        _throwIfError(
            this._api.tQueryFunction(this._node.id, trainAlias | 0, BigInt(trainId), fnAddress >>> 0),
            'train.sendQueryFunction',
        );
    }
    sendQueryController(trainAlias, trainId) {
        _throwIfError(
            this._api.tQueryController(this._node.id, trainAlias | 0, BigInt(trainId)),
            'train.sendQueryController',
        );
    }
    sendReserve(trainAlias, trainId) {
        _throwIfError(
            this._api.tReserve(this._node.id, trainAlias | 0, BigInt(trainId)),
            'train.sendReserve',
        );
    }
    sendReleaseReserve(trainAlias, trainId) {
        _throwIfError(
            this._api.tReleaseReserve(this._node.id, trainAlias | 0, BigInt(trainId)),
            'train.sendReleaseReserve',
        );
    }
    sendControllerChangingNotify(trainAlias, trainId, newControllerNodeId) {
        _throwIfError(
            this._api.tControllerChangingNotify(this._node.id, trainAlias | 0, BigInt(trainId), BigInt(newControllerNodeId)),
            'train.sendControllerChangingNotify',
        );
    }
    sendListenerAttach(trainAlias, trainId, listenerNodeId, flags = 0) {
        _throwIfError(
            this._api.tListenerAttach(this._node.id, trainAlias | 0, BigInt(trainId), BigInt(listenerNodeId), flags | 0),
            'train.sendListenerAttach',
        );
    }
    sendListenerDetach(trainAlias, trainId, listenerNodeId) {
        _throwIfError(
            this._api.tListenerDetach(this._node.id, trainAlias | 0, BigInt(trainId), BigInt(listenerNodeId)),
            'train.sendListenerDetach',
        );
    }
    sendListenerQuery(trainAlias, trainId, listenerIndex) {
        _throwIfError(
            this._api.tListenerQuery(this._node.id, trainAlias | 0, BigInt(trainId), listenerIndex | 0),
            'train.sendListenerQuery',
        );
    }

    // --- Group B: Train-side / per-train state ------------------------------
    // These require the local node to declare PSI.TRAIN_CONTROL — they
    // either reply on behalf of the train (sendSearchMatch) or read/write
    // the train_state struct that train_setup() allocates.

    sendSearchMatch(searchEventId) {
        this._checkIsTrain();
        _throwIfError(
            this._api.tSendSearchMatch(this._node.id, BigInt(searchEventId)),
            'train.sendSearchMatch',
        );
    }
    setDccAddress(dccAddress, isLong) {
        this._checkIsTrain();
        _throwIfError(
            this._api.tSetDcc(this._node.id, dccAddress >>> 0, isLong ? 1 : 0),
            'train.setDccAddress',
        );
    }
    getDccAddress() {
        this._checkIsTrain();
        return this._api.tGetDcc(this._node.id);
    }
    isLongAddress() {
        this._checkIsTrain();
        return this._api.tIsLong(this._node.id) === 1;
    }
    setSpeedSteps(steps) {
        this._checkIsTrain();
        _throwIfError(
            this._api.tSetSteps(this._node.id, steps | 0),
            'train.setSpeedSteps',
        );
    }
    getSpeedSteps() {
        this._checkIsTrain();
        return this._api.tGetSteps(this._node.id);
    }
}

class BroadcastTimeFacade {
    constructor(node, api) {
        this._node = node;
        this._api = api;
    }

    // Per-clock setup.  Required before any send/receive on a given clock.
    setupConsumer(clockId) {
        _throwIfError(
            this._api.btSetupConsumer(this._node.id, BigInt(clockId)),
            'broadcastTime.setupConsumer',
        );
    }
    setupProducer(clockId) {
        _throwIfError(
            this._api.btSetupProducer(this._node.id, BigInt(clockId)),
            'broadcastTime.setupProducer',
        );
    }

    // Local clock-slot state
    isConsumer(clockId) { return this._api.btIsConsumer(BigInt(clockId)) === 1; }
    isProducer(clockId) { return this._api.btIsProducer(BigInt(clockId)) === 1; }
    start(clockId)       { this._api.btStart(BigInt(clockId)); }
    stop(clockId)        { this._api.btStop(BigInt(clockId)); }
    triggerQueryReply(clockId) { this._api.btTriggerQueryReply(BigInt(clockId)); }
    triggerSyncDelay(clockId)  { this._api.btTriggerSyncDelay(BigInt(clockId)); }

    // Reports + commands — take (clockId, payload) pairs; node ID is implicit.
    sendReportTime(clockId, hour, minute) { _throwIfError(this._api.btReportTime(this._node.id, BigInt(clockId), hour | 0, minute | 0), 'broadcastTime.sendReportTime'); }
    sendReportDate(clockId, month, day)   { _throwIfError(this._api.btReportDate(this._node.id, BigInt(clockId), month | 0, day | 0),   'broadcastTime.sendReportDate'); }
    sendReportYear(clockId, year)         { _throwIfError(this._api.btReportYear(this._node.id, BigInt(clockId), year | 0),             'broadcastTime.sendReportYear'); }
    sendReportRate(clockId, rate)         { _throwIfError(this._api.btReportRate(this._node.id, BigInt(clockId), rate | 0),             'broadcastTime.sendReportRate'); }
    sendStart(clockId)                    { _throwIfError(this._api.btSendStart(this._node.id, BigInt(clockId)),                        'broadcastTime.sendStart'); }
    sendStop(clockId)                     { _throwIfError(this._api.btSendStop(this._node.id, BigInt(clockId)),                         'broadcastTime.sendStop'); }
    sendDateRollover(clockId)             { _throwIfError(this._api.btSendDateRollover(this._node.id, BigInt(clockId)),                 'broadcastTime.sendDateRollover'); }
    sendQuery(clockId)                    { _throwIfError(this._api.btSendQuery(this._node.id, BigInt(clockId)),                        'broadcastTime.sendQuery'); }
    sendQueryReply(clockId)               { _throwIfError(this._api.btSendQueryReply(this._node.id, BigInt(clockId)),                   'broadcastTime.sendQueryReply'); }
    sendSetTime(clockId, hour, minute)    { _throwIfError(this._api.btSetTime(this._node.id, BigInt(clockId), hour | 0, minute | 0),    'broadcastTime.sendSetTime'); }
    sendSetDate(clockId, month, day)      { _throwIfError(this._api.btSetDate(this._node.id, BigInt(clockId), month | 0, day | 0),      'broadcastTime.sendSetDate'); }
    sendSetYear(clockId, year)            { _throwIfError(this._api.btSetYear(this._node.id, BigInt(clockId), year | 0),                'broadcastTime.sendSetYear'); }
    sendSetRate(clockId, rate)            { _throwIfError(this._api.btSetRate(this._node.id, BigInt(clockId), rate | 0),                'broadcastTime.sendSetRate'); }
    sendCommandStart(clockId)             { _throwIfError(this._api.btCommandStart(this._node.id, BigInt(clockId)),                     'broadcastTime.sendCommandStart'); }
    sendCommandStop(clockId)              { _throwIfError(this._api.btCommandStop(this._node.id, BigInt(clockId)),                      'broadcastTime.sendCommandStop'); }
}

// ---------------------------------------------------------------------------
// OpenLcbNode
// ---------------------------------------------------------------------------

function _throwIfError(rc, ctx) {
    const err = errorForReturnCode(rc, ctx);
    if (err) throw err;
}

export class OpenLcbNode {
    /**
     * @param {bigint} id       48-bit OpenLCB node ID
     * @param {object} params   user-supplied (raw) parameters
     * @param {object} callbacks  user-supplied callback bag
     * @param {object} api      cwrap bundle from wasm-api.js (set after WASM loads)
     * @internal
     */
    constructor(id, params, callbacks) {
        this.id = id;
        this.parameters = resolveParameters(params);
        /** @internal */  this._callbacks = callbacks ?? {};
        /** @internal */  this._api = null;

        // Sub-protocol facades.  Exist unconditionally so IDE completion
        // works; throw ProtocolNotSupportedError at call time if the node
        // didn't opt in (TrainFacade only — broadcastTime is always OK).
        this.train          = new TrainFacade(this, null);
        this.broadcastTime  = new BroadcastTimeFacade(this, null);

        // loginComplete resolution is driven by the runtime via
        // _resolveLoginComplete.  Expose a Promise.
        this._loginResolve = null;
        /** @type {Promise<OpenLcbNode>} */
        this.loginComplete = new Promise((resolve) => { this._loginResolve = resolve; });
    }

    /** @internal — called by the runtime once the cwrap API is ready. */
    _bindApi(api) {
        this._api = api;
        this.train._api = api;
        this.broadcastTime._api = api;
    }

    /** @internal — called by the runtime from the onLoginComplete hook. */
    _resolveLoginComplete() {
        if (this._loginResolve) {
            this._loginResolve(this);
            this._loginResolve = null;
        }
    }

    // ------------------------------------------------------------------------
    // Event sends
    // ------------------------------------------------------------------------

    sendPcer(eventId) {
        _throwIfError(this._api.sendPcer(this.id, BigInt(eventId)), 'node.sendPcer');
    }

    sendEventWithMti(eventId, mti) {
        _throwIfError(this._api.sendEventWithMti(this.id, BigInt(eventId), mti | 0), 'node.sendEventWithMti');
    }

    sendTeachEvent(eventId) {
        _throwIfError(this._api.sendTeach(this.id, BigInt(eventId)), 'node.sendTeachEvent');
    }

    sendInitializationEvent() {
        _throwIfError(this._api.sendInit(this.id), 'node.sendInitializationEvent');
    }

    /**
     * Send Verify Node ID Addressed to a remote alias.  Reply arrives via the
     * runtime-level `onVerifiedNodeId(node, sourceId, sourceAlias)` callback.
     *
     * @param {number} destAlias       12-bit CAN alias of the remote node.
     * @param {bigint} [destNodeId=0n] Optional 48-bit NodeID for verification;
     *                                  pass 0n for unconditional identify.
     */
    sendVerifyNodeIdAddressed(destAlias, destNodeId = 0n) {
        _throwIfError(
            this._api.sendVerifyAddressed(this.id, destAlias | 0, BigInt(destNodeId)),
            'node.sendVerifyNodeIdAddressed',
        );
    }

    /**
     * Send Verify Node ID Global.  Every node on the bus replies; each fires
     * the runtime-level `onVerifiedNodeId(node, sourceId, sourceAlias)`
     * callback once.
     */
    sendVerifyNodeIdGlobal() {
        _throwIfError(
            this._api.sendVerifyGlobal(this.id),
            'node.sendVerifyNodeIdGlobal',
        );
    }

    // ------------------------------------------------------------------------
    // Consumer / producer registration
    // ------------------------------------------------------------------------

    /**
     * @param {bigint} eventId
     * @param {number} status   EventStatus value (0/1/2/3)
     * @returns {number} list index on success
     */
    registerConsumer(eventId, status = 0) {
        const rc = this._api.regCEvent(this.id, BigInt(eventId), status | 0);
        if (rc < 0) _throwIfError(rc, 'node.registerConsumer');
        return rc;
    }
    registerProducer(eventId, status = 0) {
        const rc = this._api.regPEvent(this.id, BigInt(eventId), status | 0);
        if (rc < 0) _throwIfError(rc, 'node.registerProducer');
        return rc;
    }

    clearConsumers() { _throwIfError(this._api.clearCEvents(this.id), 'node.clearConsumers'); }
    clearProducers() { _throwIfError(this._api.clearPEvents(this.id), 'node.clearProducers'); }

    registerConsumerRange(baseEventId, countEnum) {
        const rc = this._api.regCRange(this.id, BigInt(baseEventId), countEnum | 0);
        if (rc < 0) _throwIfError(rc, 'node.registerConsumerRange');
        return rc;
    }
    registerProducerRange(baseEventId, countEnum) {
        const rc = this._api.regPRange(this.id, BigInt(baseEventId), countEnum | 0);
        if (rc < 0) _throwIfError(rc, 'node.registerProducerRange');
        return rc;
    }
    clearConsumerRanges() { _throwIfError(this._api.clearCRanges(this.id), 'node.clearConsumerRanges'); }
    clearProducerRanges() { _throwIfError(this._api.clearPRanges(this.id), 'node.clearProducerRanges'); }

    // ------------------------------------------------------------------------
    // Node-scoped queries
    // ------------------------------------------------------------------------

    /** @returns {number | null} producer list index, or null if not assigned. */
    isProducerEventAssigned(eventId) {
        const rc = this._api.isProducerAssigned(this.id, BigInt(eventId));
        return rc < 0 ? null : rc;
    }
    /** @returns {number | null} consumer list index, or null if not assigned. */
    isConsumerEventAssigned(eventId) {
        const rc = this._api.isConsumerAssigned(this.id, BigInt(eventId));
        return rc < 0 ? null : rc;
    }
    isEventInProducerRanges(eventId) {
        return this._api.isEventInProducerRanges(this.id, BigInt(eventId)) === 1;
    }
    isEventInConsumerRanges(eventId) {
        return this._api.isEventInConsumerRanges(this.id, BigInt(eventId)) === 1;
    }
}

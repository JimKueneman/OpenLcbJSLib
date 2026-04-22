// Ported from OpenLcbCLib/src/openlcb/openlcb_application_train.[hc].
//
// Application-side Train Control Protocol surface:
//   * `setup(node)` — assign a freshly-zeroed train_state to a node and
//     register the standard train event IDs (Train producer, emergency
//     consumers).
//   * Throttle-side send helpers — build MTI_TRAIN_PROTOCOL command messages
//     and push them via the application's sendOpenlcbMsg callback.
//   * 100ms heartbeat tick — decrements per-train countdown; at the halfway
//     point the train sends a NOOP heartbeat to its controller; at zero the
//     train emergency-stops and forwards Set Speed 0 to each listener.
//
// The protocol-side decoding and reply-building lives in Phase 5's
// ProtocolTrainHandler; this module is the app-facing counterpart.

import {
    MTI_TRAIN_PROTOCOL,
    MTI_TRAIN_REPLY,
    TRAIN_SET_SPEED_DIRECTION,
    TRAIN_SET_FUNCTION,
    TRAIN_EMERGENCY_STOP,
    TRAIN_QUERY_SPEEDS,
    TRAIN_QUERY_FUNCTION,
    TRAIN_CONTROLLER_CONFIG,
    TRAIN_CONTROLLER_ASSIGN,
    TRAIN_CONTROLLER_RELEASE,
    TRAIN_MANAGEMENT,
    TRAIN_MGMT_NOOP,
    TRAIN_INSTRUCTION_P_BIT,
    TRAIN_LISTENER_FLAG_REVERSE,
    EVENT_ID_TRAIN,
    EVENT_ID_EMERGENCY_OFF,
    EVENT_ID_EMERGENCY_STOP,
    EVENT_ID_CLEAR_EMERGENCY_OFF,
    EVENT_ID_CLEAR_EMERGENCY_STOP,
} from './defines.js';
import { EVENT_STATUS, PAYLOAD_TYPE, createMessage } from './types.js';
import {
    FLOAT16_NAN,
    FLOAT16_NEGATIVE_ZERO,
    FLOAT16_POSITIVE_ZERO,
    getDirection as float16GetDirection,
} from './float16.js';
import {
    loadOpenlcbMessage,
    copyByteToPayload,
    copyWordToPayload,
    copyNodeIdToPayload,
} from './utilities.js';

/** Default function count — NMRA F0-F28. */
const DEFAULT_FUNCTION_COUNT = 29;

/** Max listeners per train — configurable; matches C's USER_DEFINED_MAX_LISTENERS_PER_TRAIN default. */
const DEFAULT_MAX_LISTENERS = 8;

function createTrainState() {
    return {
        setSpeed: 0,
        commandedSpeed: FLOAT16_NAN,
        actualSpeed: FLOAT16_NAN,
        estopActive: false,
        globalEstopActive: false,
        globalEoffActive: false,
        controllerNodeId: 0n,
        controllerAlias: 0,
        reservedNodeCount: 0,
        reservedByNodeId: 0n,
        heartbeatTimeoutS: 0,
        heartbeatCounter100ms: 0,
        listeners: Array.from({ length: DEFAULT_MAX_LISTENERS }, () => ({ nodeId: 0n, flags: 0 })),
        listenerCount: 0,
        listenerEnumIndex: 0,
        functions: new Uint16Array(DEFAULT_FUNCTION_COUNT),
        dccAddress: 0,
        isLongAddress: false,
        speedSteps: 0,
        heartbeatSendPending: false,
        estopForwardPending: false,
        ownerNode: null,
    };
}

// =============================================================================

export class OpenLcbApplicationTrain {
    /**
     * @param {Object} deps
     * @param {OpenLcbApplication} deps.application  required — used for event registration
     * @param {(msg) => boolean} deps.sendOpenlcbMsg required
     * @param {(node) => void}   [deps.onHeartbeatTimeout]
     */
    constructor(deps) {
        this._application = deps.application;
        this._sendOpenlcbMsg = deps.sendOpenlcbMsg;
        this._onHeartbeatTimeout = deps.onHeartbeatTimeout ?? null;
        this._trainStates = []; // allocated train states (for heartbeat scanning)
        this._lastHeartbeatTick = 0;
    }

    // -------------------------------------------------------------------------
    // State allocation
    // -------------------------------------------------------------------------

    /**
     * Allocate a train state slot, attach it to the node, and register the
     * standard train event IDs. Returns the existing state if already set.
     */
    setup(node) {
        if (!node) return null;
        if (node.trainState) return node.trainState;

        const state = createTrainState();
        state.ownerNode = node;
        node.trainState = state;
        this._trainStates.push(state);

        // Standard train event registration.
        this._application.registerProducerEventId(node, EVENT_ID_TRAIN,                  EVENT_STATUS.SET);
        this._application.registerConsumerEventId(node, EVENT_ID_EMERGENCY_OFF,          EVENT_STATUS.SET);
        this._application.registerConsumerEventId(node, EVENT_ID_EMERGENCY_STOP,         EVENT_STATUS.SET);
        this._application.registerConsumerEventId(node, EVENT_ID_CLEAR_EMERGENCY_OFF,    EVENT_STATUS.SET);
        this._application.registerConsumerEventId(node, EVENT_ID_CLEAR_EMERGENCY_STOP,   EVENT_STATUS.SET);

        return state;
    }

    getState(node) {
        return node ? node.trainState : null;
    }

    // -------------------------------------------------------------------------
    // Heartbeat countdown (invoke from main loop each 100ms tick)
    // -------------------------------------------------------------------------

    timerTick(currentTick) {
        const ticksElapsed = (currentTick - this._lastHeartbeatTick) & 0xFF;
        if (ticksElapsed === 0) return;
        this._lastHeartbeatTick = currentTick & 0xFF;

        for (const state of this._trainStates) {
            if (state.heartbeatTimeoutS === 0) continue;
            // §6.6: with no controller, train keeps running as last commanded
            // — countdown and estop-on-expiry only apply while assigned.
            if (state.controllerNodeId === 0n) continue;

            if (state.heartbeatSendPending) {
                if (this._sendHeartbeatRequest(state)) state.heartbeatSendPending = false;
            }

            if (state.estopForwardPending) {
                if (this._forwardEstopToOneListener(state)) state.listenerEnumIndex++;
                if (state.listenerEnumIndex >= state.listenerCount) state.estopForwardPending = false;
                continue; // skip countdown while forwarding
            }

            const oldCounter = state.heartbeatCounter100ms;
            state.heartbeatCounter100ms = Math.max(0, state.heartbeatCounter100ms - ticksElapsed);

            const halfway = (state.heartbeatTimeoutS * 10) >>> 1;
            if (oldCounter > halfway && state.heartbeatCounter100ms <= halfway) {
                if (!this._sendHeartbeatRequest(state)) state.heartbeatSendPending = true;
            }

            if (state.heartbeatCounter100ms === 0 && oldCounter > 0) {
                state.estopActive = true;
                // Preserve direction, zero magnitude.
                state.setSpeed = float16GetDirection(state.setSpeed)
                    ? FLOAT16_NEGATIVE_ZERO
                    : FLOAT16_POSITIVE_ZERO;

                // TrainControlS §6.6: forward the implied Set Speed 0 to all
                // registered listeners one-per-tick.
                if (state.listenerCount > 0) {
                    state.estopForwardPending = true;
                    state.listenerEnumIndex = 0;
                }

                this._onHeartbeatTimeout?.(state.ownerNode);
            }
        }
    }

    _sendHeartbeatRequest(state) {
        const node = state.ownerNode;
        if (!node || state.controllerNodeId === 0n) return false;

        const msg = createMessage({ payloadType: PAYLOAD_TYPE.BASIC });
        loadOpenlcbMessage(
            msg,
            node.alias, node.id,
            state.controllerAlias, state.controllerNodeId,
            MTI_TRAIN_REPLY
        );
        copyByteToPayload(msg, TRAIN_MANAGEMENT, 0);
        copyByteToPayload(msg, TRAIN_MGMT_NOOP, 1);
        const to = state.heartbeatTimeoutS;
        copyByteToPayload(msg, (to >>> 16) & 0xFF, 2);
        copyByteToPayload(msg, (to >>>  8) & 0xFF, 3);
        copyByteToPayload(msg,  to         & 0xFF, 4);
        return this._sendOpenlcbMsg(msg);
    }

    _forwardEstopToOneListener(state) {
        const node = state.ownerNode;
        if (!node || state.listenerEnumIndex >= state.listenerCount) return false;

        const entry = state.listeners[state.listenerEnumIndex];
        const msg = createMessage({ payloadType: PAYLOAD_TYPE.BASIC });
        loadOpenlcbMessage(msg, node.alias, node.id, 0, entry.nodeId, MTI_TRAIN_PROTOCOL);

        let speed = state.setSpeed;
        if (entry.flags & TRAIN_LISTENER_FLAG_REVERSE) speed ^= 0x8000;
        copyByteToPayload(msg, TRAIN_SET_SPEED_DIRECTION | TRAIN_INSTRUCTION_P_BIT, 0);
        copyWordToPayload(msg, speed, 1);
        return this._sendOpenlcbMsg(msg);
    }

    // -------------------------------------------------------------------------
    // Throttle-side send helpers
    // -------------------------------------------------------------------------

    _prepareCommand(node, trainAlias, trainNodeId) {
        const msg = createMessage({ payloadType: PAYLOAD_TYPE.BASIC });
        loadOpenlcbMessage(msg, node.alias, node.id, trainAlias, trainNodeId, MTI_TRAIN_PROTOCOL);
        return msg;
    }

    sendSetSpeed(node, trainAlias, trainNodeId, speed) {
        const msg = this._prepareCommand(node, trainAlias, trainNodeId);
        copyByteToPayload(msg, TRAIN_SET_SPEED_DIRECTION, 0);
        copyWordToPayload(msg, speed, 1);
        this._sendOpenlcbMsg(msg);
    }

    sendSetFunction(node, trainAlias, trainNodeId, fnAddress, fnValue) {
        const msg = this._prepareCommand(node, trainAlias, trainNodeId);
        copyByteToPayload(msg, TRAIN_SET_FUNCTION, 0);
        copyByteToPayload(msg, (fnAddress >>> 16) & 0xFF, 1);
        copyByteToPayload(msg, (fnAddress >>>  8) & 0xFF, 2);
        copyByteToPayload(msg,  fnAddress         & 0xFF, 3);
        copyWordToPayload(msg, fnValue, 4);
        this._sendOpenlcbMsg(msg);
    }

    sendEmergencyStop(node, trainAlias, trainNodeId) {
        const msg = this._prepareCommand(node, trainAlias, trainNodeId);
        copyByteToPayload(msg, TRAIN_EMERGENCY_STOP, 0);
        this._sendOpenlcbMsg(msg);
    }

    sendQuerySpeeds(node, trainAlias, trainNodeId) {
        const msg = this._prepareCommand(node, trainAlias, trainNodeId);
        copyByteToPayload(msg, TRAIN_QUERY_SPEEDS, 0);
        this._sendOpenlcbMsg(msg);
    }

    sendQueryFunction(node, trainAlias, trainNodeId, fnAddress) {
        const msg = this._prepareCommand(node, trainAlias, trainNodeId);
        copyByteToPayload(msg, TRAIN_QUERY_FUNCTION, 0);
        copyByteToPayload(msg, (fnAddress >>> 16) & 0xFF, 1);
        copyByteToPayload(msg, (fnAddress >>>  8) & 0xFF, 2);
        copyByteToPayload(msg,  fnAddress         & 0xFF, 3);
        this._sendOpenlcbMsg(msg);
    }

    sendAssignController(node, trainAlias, trainNodeId) {
        const msg = this._prepareCommand(node, trainAlias, trainNodeId);
        copyByteToPayload(msg, TRAIN_CONTROLLER_CONFIG, 0);
        copyByteToPayload(msg, TRAIN_CONTROLLER_ASSIGN, 1);
        copyNodeIdToPayload(msg, node.id, 2);
        this._sendOpenlcbMsg(msg);
    }

    sendReleaseController(node, trainAlias, trainNodeId) {
        const msg = this._prepareCommand(node, trainAlias, trainNodeId);
        copyByteToPayload(msg, TRAIN_CONTROLLER_CONFIG, 0);
        copyByteToPayload(msg, TRAIN_CONTROLLER_RELEASE, 1);
        copyNodeIdToPayload(msg, node.id, 2);
        this._sendOpenlcbMsg(msg);
    }

    sendNoop(node, trainAlias, trainNodeId) {
        const msg = this._prepareCommand(node, trainAlias, trainNodeId);
        copyByteToPayload(msg, TRAIN_MANAGEMENT, 0);
        copyByteToPayload(msg, TRAIN_MGMT_NOOP, 1);
        this._sendOpenlcbMsg(msg);
    }

    // -------------------------------------------------------------------------
    // Accessors
    // -------------------------------------------------------------------------

    setDccAddress(node, dccAddress, isLongAddress) {
        if (!node?.trainState) return;
        node.trainState.dccAddress = dccAddress;
        node.trainState.isLongAddress = !!isLongAddress;
    }

    getDccAddress(node) {
        return node?.trainState ? node.trainState.dccAddress : 0;
    }

    isLongAddress(node) {
        return node?.trainState ? !!node.trainState.isLongAddress : false;
    }

    setSpeedSteps(node, speedSteps) {
        if (!node?.trainState) return;
        node.trainState.speedSteps = speedSteps;
    }

    getSpeedSteps(node) {
        return node?.trainState ? node.trainState.speedSteps : 0;
    }
}

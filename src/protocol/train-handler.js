// Ported (core) from OpenLcbCLib/src/openlcb/protocol_train_handler.[hc].
//
// Train Control Protocol message handler — dispatches MTI_TRAIN_PROTOCOL
// (0x05EB) commands and MTI_TRAIN_REPLY (0x01E9) replies. Updates the node's
// `trainState` in place and fires notifier/decision callbacks provided by
// the application.
//
// The C file is ~1500 lines because each sub-command has its own response
// builder; this JS port dispatches on instruction byte + sub-command byte
// and delegates the per-sub-command work to focused helpers.

import {
    MTI_TRAIN_REPLY,
    TRAIN_SET_SPEED_DIRECTION,
    TRAIN_SET_FUNCTION,
    TRAIN_EMERGENCY_STOP,
    TRAIN_QUERY_SPEEDS,
    TRAIN_QUERY_FUNCTION,
    TRAIN_CONTROLLER_CONFIG,
    TRAIN_LISTENER_CONFIG,
    TRAIN_MANAGEMENT,
    TRAIN_CONTROLLER_ASSIGN,
    TRAIN_CONTROLLER_RELEASE,
    TRAIN_CONTROLLER_QUERY,
    TRAIN_CONTROLLER_CHANGED,
    TRAIN_LISTENER_ATTACH,
    TRAIN_LISTENER_DETACH,
    TRAIN_LISTENER_QUERY,
    TRAIN_MGMT_RESERVE,
    TRAIN_MGMT_RELEASE,
    TRAIN_MGMT_NOOP,
    EVENT_ID_EMERGENCY_OFF,
    EVENT_ID_CLEAR_EMERGENCY_OFF,
    EVENT_ID_EMERGENCY_STOP,
    EVENT_ID_CLEAR_EMERGENCY_STOP,
} from '../openlcb/defines.js';
import { TRAIN_EMERGENCY_TYPE } from '../openlcb/types.js';
import {
    FLOAT16_NAN,
    FLOAT16_NEGATIVE_ZERO,
    FLOAT16_POSITIVE_ZERO,
    getDirection,
    isZero as float16IsZero,
} from '../openlcb/float16.js';
import {
    loadOpenlcbMessage,
    copyByteToPayload,
    copyWordToPayload,
    copyNodeIdToPayload,
    extractByteFromPayload,
    extractWordFromPayload,
    extractNodeIdFromPayload,
} from '../openlcb/utilities.js';

/** 24-bit big-endian function address at `offset`..`offset+2`. */
function extractFnAddress(msg, offset) {
    return ((msg.payload[offset] << 16) | (msg.payload[offset + 1] << 8) | msg.payload[offset + 2]) >>> 0;
}

function copyFnAddress(msg, fnAddress, offset) {
    copyByteToPayload(msg, (fnAddress >>> 16) & 0xFF, offset);
    copyByteToPayload(msg, (fnAddress >>>  8) & 0xFF, offset + 1);
    copyByteToPayload(msg,  fnAddress         & 0xFF, offset + 2);
}

// =============================================================================

export class ProtocolTrainHandler {
    /** @param {Object} [deps] — callback bag per interface_protocol_train_handler_t */
    constructor(deps = {}) {
        this._cb = deps;
    }

    // -------------------------------------------------------------------------
    // Reply-message builder (instruction byte + sub-command at byte 0)
    // -------------------------------------------------------------------------

    _startReply(sm, instructionByte) {
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_TRAIN_REPLY
        );
        copyByteToPayload(sm.outgoing.msg, instructionByte, 0);
    }

    // -------------------------------------------------------------------------
    // Public entry points
    // -------------------------------------------------------------------------

    /** MTI_TRAIN_PROTOCOL (0x05EB) — incoming command to a train node. */
    handleTrainCommand(sm) {
        if (!sm.node.trainState) return;
        const instruction = extractByteFromPayload(sm.incoming.msg, 0) & 0x7F;

        switch (instruction) {
            case TRAIN_SET_SPEED_DIRECTION:  return this._handleSetSpeed(sm);
            case TRAIN_SET_FUNCTION:         return this._handleSetFunction(sm);
            case TRAIN_EMERGENCY_STOP:       return this._handleEmergencyStop(sm);
            case TRAIN_QUERY_SPEEDS:         return this._handleQuerySpeeds(sm);
            case TRAIN_QUERY_FUNCTION:       return this._handleQueryFunction(sm);
            case TRAIN_CONTROLLER_CONFIG:    return this._handleControllerConfig(sm);
            case TRAIN_LISTENER_CONFIG:      return this._handleListenerConfig(sm);
            case TRAIN_MANAGEMENT:           return this._handleManagement(sm);
            default:                         return;
        }
    }

    /** MTI_TRAIN_REPLY (0x01E9) — incoming reply on the throttle side. */
    handleTrainReply(sm) {
        const instruction = extractByteFromPayload(sm.incoming.msg, 0) & 0x7F;

        switch (instruction) {
            case TRAIN_QUERY_SPEEDS:       return this._handleQuerySpeedsReply(sm);
            case TRAIN_QUERY_FUNCTION:     return this._handleQueryFunctionReply(sm);
            case TRAIN_CONTROLLER_CONFIG:  return this._handleControllerConfigReply(sm);
            case TRAIN_LISTENER_CONFIG:    return this._handleListenerConfigReply(sm);
            case TRAIN_MANAGEMENT:         return this._handleManagementReply(sm);
            default:                       return;
        }
    }

    /** Global or addressed emergency PCER. */
    handleEmergencyEvent(sm, eventId) {
        const state = sm.node.trainState;
        if (!state) return;

        switch (eventId) {
            case EVENT_ID_EMERGENCY_OFF:
                state.globalEoffActive = true;
                this._cb.onEmergencyEntered?.(sm.node, TRAIN_EMERGENCY_TYPE.GLOBAL_OFF);
                break;
            case EVENT_ID_CLEAR_EMERGENCY_OFF:
                state.globalEoffActive = false;
                this._cb.onEmergencyExited?.(sm.node, TRAIN_EMERGENCY_TYPE.GLOBAL_OFF);
                break;
            case EVENT_ID_EMERGENCY_STOP:
                state.globalEstopActive = true;
                this._cb.onEmergencyEntered?.(sm.node, TRAIN_EMERGENCY_TYPE.GLOBAL_STOP);
                break;
            case EVENT_ID_CLEAR_EMERGENCY_STOP:
                state.globalEstopActive = false;
                this._cb.onEmergencyExited?.(sm.node, TRAIN_EMERGENCY_TYPE.GLOBAL_STOP);
                break;
        }
    }

    /** True iff `eventId` is one of the four well-known emergency events. */
    static isEmergencyEvent(eventId) {
        return eventId === EVENT_ID_EMERGENCY_OFF
            || eventId === EVENT_ID_CLEAR_EMERGENCY_OFF
            || eventId === EVENT_ID_EMERGENCY_STOP
            || eventId === EVENT_ID_CLEAR_EMERGENCY_STOP;
    }

    // -------------------------------------------------------------------------
    // Command handlers (train-node side)
    // -------------------------------------------------------------------------

    _handleSetSpeed(sm) {
        const state = sm.node.trainState;
        const speed = extractWordFromPayload(sm.incoming.msg, 1);
        if (state) {
            state.setSpeed = speed;
            state.estopActive = false;

            // TrainControlS §6.6: restart heartbeat when speed != 0, stop when 0.
            if (state.heartbeatTimeoutS > 0) {
                state.heartbeatCounter100ms = float16IsZero(speed) ? 0 : state.heartbeatTimeoutS * 10;
            }
        }
        this._cb.onSpeedChanged?.(sm.node, speed);
    }

    _handleSetFunction(sm) {
        const state = sm.node.trainState;
        const fnAddress = extractFnAddress(sm.incoming.msg, 1);
        const fnValue = extractWordFromPayload(sm.incoming.msg, 4);
        if (state && fnAddress < state.functions.length) {
            state.functions[fnAddress] = fnValue;
        }
        this._cb.onFunctionChanged?.(sm.node, fnAddress, fnValue);
    }

    _handleEmergencyStop(sm) {
        const state = sm.node.trainState;
        if (state) {
            state.estopActive = true;
            const reverse = getDirection(state.setSpeed);
            state.setSpeed = reverse ? FLOAT16_NEGATIVE_ZERO : FLOAT16_POSITIVE_ZERO;
            state.heartbeatCounter100ms = 0;
        }
        this._cb.onEmergencyEntered?.(sm.node, TRAIN_EMERGENCY_TYPE.ESTOP);
    }

    _handleQuerySpeeds(sm) {
        const state = sm.node.trainState;
        const setSpeed = state ? state.setSpeed : 0;
        const status = state && state.estopActive ? 0x01 : 0x00;
        const commanded = state ? state.commandedSpeed : FLOAT16_NAN;
        const actual = state ? state.actualSpeed : FLOAT16_NAN;

        this._startReply(sm, TRAIN_QUERY_SPEEDS);
        copyWordToPayload(sm.outgoing.msg, setSpeed, 1);
        copyByteToPayload(sm.outgoing.msg, status, 3);
        copyWordToPayload(sm.outgoing.msg, commanded, 4);
        copyWordToPayload(sm.outgoing.msg, actual, 6);
        sm.outgoing.valid = true;
    }

    _handleQueryFunction(sm) {
        const state = sm.node.trainState;
        const fnAddress = extractFnAddress(sm.incoming.msg, 1);
        const fnValue = state && fnAddress < state.functions.length ? state.functions[fnAddress] : 0;

        this._startReply(sm, TRAIN_QUERY_FUNCTION);
        copyFnAddress(sm.outgoing.msg, fnAddress, 1);
        copyWordToPayload(sm.outgoing.msg, fnValue, 4);
        sm.outgoing.valid = true;
    }

    _handleControllerConfig(sm) {
        const state = sm.node.trainState;
        const msg = sm.incoming.msg;
        const sub = extractByteFromPayload(msg, 1);

        switch (sub) {
            case TRAIN_CONTROLLER_ASSIGN: {
                const requesting = extractNodeIdFromPayload(msg, 3);
                let accepted = true;
                if (state) {
                    if (state.controllerNodeId === 0n || state.controllerNodeId === requesting) {
                        state.controllerNodeId = requesting;
                        state.controllerAlias = msg.sourceAlias;
                    } else {
                        accepted = this._cb.onControllerAssignRequest
                            ? this._cb.onControllerAssignRequest(sm.node, state.controllerNodeId, requesting)
                            : true;
                        if (accepted) {
                            state.controllerNodeId = requesting;
                            state.controllerAlias = msg.sourceAlias;
                        }
                    }
                    // §6.6: arm heartbeat on successful assign so a subsequent
                    // release doesn't leave a stale zero-countdown that would
                    // estop the train on the very next tick.
                    if (accepted && state.heartbeatTimeoutS > 0) {
                        state.heartbeatCounter100ms = state.heartbeatTimeoutS * 10;
                    }
                }
                this._startReply(sm, TRAIN_CONTROLLER_CONFIG);
                copyByteToPayload(sm.outgoing.msg, TRAIN_CONTROLLER_ASSIGN, 1);
                copyByteToPayload(sm.outgoing.msg, accepted ? 0 : 1, 2);
                if (!accepted && state) {
                    copyNodeIdToPayload(sm.outgoing.msg, state.controllerNodeId, 3);
                }
                sm.outgoing.valid = true;
                if (accepted) this._cb.onControllerAssigned?.(sm.node, requesting);
                break;
            }
            case TRAIN_CONTROLLER_RELEASE: {
                const releasing = extractNodeIdFromPayload(msg, 3);
                if (state && (state.controllerNodeId === releasing || releasing === 0n)) {
                    state.controllerNodeId = 0n;
                    state.controllerAlias = 0;
                }
                this._startReply(sm, TRAIN_CONTROLLER_CONFIG);
                copyByteToPayload(sm.outgoing.msg, TRAIN_CONTROLLER_RELEASE, 1);
                copyByteToPayload(sm.outgoing.msg, 0, 2);
                sm.outgoing.valid = true;
                this._cb.onControllerReleased?.(sm.node);
                break;
            }
            case TRAIN_CONTROLLER_QUERY: {
                this._startReply(sm, TRAIN_CONTROLLER_CONFIG);
                copyByteToPayload(sm.outgoing.msg, TRAIN_CONTROLLER_QUERY, 1);
                // flags byte — bit 0 set iff a controller is currently assigned
                const flags = (state && state.controllerNodeId !== 0n) ? 0x01 : 0x00;
                copyByteToPayload(sm.outgoing.msg, flags, 2);
                copyNodeIdToPayload(sm.outgoing.msg, state ? state.controllerNodeId : 0n, 3);
                sm.outgoing.valid = true;
                break;
            }
            case TRAIN_CONTROLLER_CHANGED: {
                const newController = extractNodeIdFromPayload(msg, 3);
                const accepted = this._cb.onControllerChangedRequest
                    ? this._cb.onControllerChangedRequest(sm.node, newController)
                    : true;
                if (state && accepted) {
                    state.controllerNodeId = newController;
                    state.controllerAlias = msg.sourceAlias;
                }
                this._startReply(sm, TRAIN_CONTROLLER_CONFIG);
                copyByteToPayload(sm.outgoing.msg, TRAIN_CONTROLLER_CHANGED, 1);
                copyByteToPayload(sm.outgoing.msg, accepted ? 0 : 1, 2);
                sm.outgoing.valid = true;
                if (accepted) this._cb.onControllerAssigned?.(sm.node, newController);
                break;
            }
        }
    }

    _handleListenerConfig(sm) {
        const state = sm.node.trainState;
        const msg = sm.incoming.msg;
        const sub = extractByteFromPayload(msg, 1);

        switch (sub) {
            case TRAIN_LISTENER_ATTACH: {
                const flags = extractByteFromPayload(msg, 2);
                const listenerId = extractNodeIdFromPayload(msg, 3);
                let result = 0;
                if (state && listenerId !== 0n) {
                    const max = state.listeners.length;
                    let slot = -1;
                    for (let i = 0; i < state.listenerCount; i++) {
                        if (state.listeners[i].nodeId === listenerId) { slot = i; break; }
                    }
                    if (slot >= 0) {
                        state.listeners[slot].flags = flags;
                    } else if (state.listenerCount < max) {
                        state.listeners[state.listenerCount].nodeId = listenerId;
                        state.listeners[state.listenerCount].flags = flags;
                        state.listenerCount++;
                    } else {
                        result = 0xFF;
                    }
                } else {
                    result = 0xFF;
                }
                this._startReply(sm, TRAIN_LISTENER_CONFIG);
                copyByteToPayload(sm.outgoing.msg, TRAIN_LISTENER_ATTACH, 1);
                copyNodeIdToPayload(sm.outgoing.msg, listenerId, 2);
                copyByteToPayload(sm.outgoing.msg, result, 8);
                sm.outgoing.valid = true;
                if (result === 0) this._cb.onListenerChanged?.(sm.node);
                break;
            }
            case TRAIN_LISTENER_DETACH: {
                const listenerId = extractNodeIdFromPayload(msg, 3);
                let result = 0;
                if (state && listenerId !== 0n) {
                    let idx = -1;
                    for (let i = 0; i < state.listenerCount; i++) {
                        if (state.listeners[i].nodeId === listenerId) { idx = i; break; }
                    }
                    if (idx >= 0) {
                        for (let j = idx; j < state.listenerCount - 1; j++) {
                            state.listeners[j].nodeId = state.listeners[j + 1].nodeId;
                            state.listeners[j].flags = state.listeners[j + 1].flags;
                        }
                        state.listenerCount--;
                        state.listeners[state.listenerCount].nodeId = 0n;
                        state.listeners[state.listenerCount].flags = 0;
                    } else {
                        result = 0xFF;
                    }
                } else {
                    result = 0xFF;
                }
                this._startReply(sm, TRAIN_LISTENER_CONFIG);
                copyByteToPayload(sm.outgoing.msg, TRAIN_LISTENER_DETACH, 1);
                copyNodeIdToPayload(sm.outgoing.msg, listenerId, 2);
                copyByteToPayload(sm.outgoing.msg, result, 8);
                sm.outgoing.valid = true;
                if (result === 0) this._cb.onListenerChanged?.(sm.node);
                break;
            }
            case TRAIN_LISTENER_QUERY: {
                const requestedIndex = extractByteFromPayload(msg, 2);
                const count = state ? state.listenerCount : 0;
                let entryFlags = 0;
                let entryNodeId = 0n;
                if (count > 0 && requestedIndex < count) {
                    entryFlags = state.listeners[requestedIndex].flags;
                    entryNodeId = state.listeners[requestedIndex].nodeId;
                }
                this._startReply(sm, TRAIN_LISTENER_CONFIG);
                copyByteToPayload(sm.outgoing.msg, TRAIN_LISTENER_QUERY, 1);
                copyByteToPayload(sm.outgoing.msg, count, 2);
                copyByteToPayload(sm.outgoing.msg, requestedIndex, 3);
                copyByteToPayload(sm.outgoing.msg, entryFlags, 4);
                copyNodeIdToPayload(sm.outgoing.msg, entryNodeId, 5);
                sm.outgoing.valid = true;
                break;
            }
        }
    }

    _handleManagement(sm) {
        const state = sm.node.trainState;
        const sub = extractByteFromPayload(sm.incoming.msg, 1);

        switch (sub) {
            case TRAIN_MGMT_RESERVE: {
                const result = state && state.reservedByNodeId === 0n ? 0 : 1;
                if (state && result === 0) {
                    state.reservedByNodeId = sm.incoming.msg.sourceId;
                }
                this._startReply(sm, TRAIN_MANAGEMENT);
                copyByteToPayload(sm.outgoing.msg, TRAIN_MGMT_RESERVE, 1);
                copyByteToPayload(sm.outgoing.msg, result, 2);
                sm.outgoing.valid = true;
                break;
            }
            case TRAIN_MGMT_RELEASE: {
                if (state) state.reservedByNodeId = 0n;
                this._startReply(sm, TRAIN_MANAGEMENT);
                copyByteToPayload(sm.outgoing.msg, TRAIN_MGMT_RELEASE, 1);
                copyByteToPayload(sm.outgoing.msg, 0, 2);
                sm.outgoing.valid = true;
                break;
            }
            case TRAIN_MGMT_NOOP: {
                if (state && state.heartbeatTimeoutS > 0) {
                    state.heartbeatCounter100ms = state.heartbeatTimeoutS * 10;
                }
                this._startReply(sm, TRAIN_MANAGEMENT);
                copyByteToPayload(sm.outgoing.msg, TRAIN_MGMT_NOOP, 1);
                copyByteToPayload(sm.outgoing.msg, 0, 2);
                sm.outgoing.valid = true;
                break;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Reply handlers (throttle side)
    // -------------------------------------------------------------------------

    _handleQuerySpeedsReply(sm) {
        const msg = sm.incoming.msg;
        const setSpeed = extractWordFromPayload(msg, 1);
        const status = extractByteFromPayload(msg, 3);
        const commanded = extractWordFromPayload(msg, 4);
        const actual = extractWordFromPayload(msg, 6);
        this._cb.onQuerySpeedsReply?.(sm.node, setSpeed, status, commanded, actual);
    }

    _handleQueryFunctionReply(sm) {
        const msg = sm.incoming.msg;
        const fnAddress = extractFnAddress(msg, 1);
        const fnValue = extractWordFromPayload(msg, 4);
        this._cb.onQueryFunctionReply?.(sm.node, fnAddress, fnValue);
    }

    _handleControllerConfigReply(sm) {
        const msg = sm.incoming.msg;
        const sub = extractByteFromPayload(msg, 1);
        const result = extractByteFromPayload(msg, 2);

        switch (sub) {
            case TRAIN_CONTROLLER_ASSIGN: {
                const current = result === 0 ? 0n : extractNodeIdFromPayload(msg, 3);
                this._cb.onControllerAssignReply?.(sm.node, result, current);
                break;
            }
            case TRAIN_CONTROLLER_QUERY: {
                const flags = result;
                const controller = extractNodeIdFromPayload(msg, 3);
                this._cb.onControllerQueryReply?.(sm.node, flags, controller);
                break;
            }
            case TRAIN_CONTROLLER_CHANGED: {
                this._cb.onControllerChangedNotifyReply?.(sm.node, result);
                break;
            }
        }
    }

    _handleListenerConfigReply(sm) {
        const msg = sm.incoming.msg;
        const sub = extractByteFromPayload(msg, 1);
        const result = extractByteFromPayload(msg, 2);

        switch (sub) {
            case TRAIN_LISTENER_ATTACH: {
                const nodeId = extractNodeIdFromPayload(msg, 3);
                this._cb.onListenerAttachReply?.(sm.node, nodeId, result);
                break;
            }
            case TRAIN_LISTENER_DETACH: {
                const nodeId = extractNodeIdFromPayload(msg, 3);
                this._cb.onListenerDetachReply?.(sm.node, nodeId, result);
                break;
            }
            case TRAIN_LISTENER_QUERY: {
                // result byte = count, then index, flags, node id
                const count = result;
                const index = extractByteFromPayload(msg, 3);
                const flags = extractByteFromPayload(msg, 4);
                const nodeId = extractNodeIdFromPayload(msg, 5);
                this._cb.onListenerQueryReply?.(sm.node, count, index, flags, nodeId);
                break;
            }
        }
    }

    _handleManagementReply(sm) {
        const msg = sm.incoming.msg;
        const sub = extractByteFromPayload(msg, 1);
        const result = extractByteFromPayload(msg, 2);

        if (sub === TRAIN_MGMT_RESERVE) {
            this._cb.onReserveReply?.(sm.node, result);
        } else if (sub === TRAIN_MGMT_NOOP) {
            // Heartbeat NOOP reply — payload bytes 3-6 may carry a timeout.
            const timeoutSeconds = msg.payloadCount >= 7
                ? ((msg.payload[3] << 24) | (msg.payload[4] << 16) | (msg.payload[5] << 8) | msg.payload[6]) >>> 0
                : 0;
            this._cb.onHeartbeatRequest?.(sm.node, timeoutSeconds);
        }
    }
}

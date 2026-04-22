// Ported from OpenLcbCLib/src/openlcb/protocol_config_mem_operations_handler.[hc].
//
// Handles the config-memory operations sub-commands that aren't read/write
// per se: Get Options, Get Address Space Info, Lock/Reserve, Freeze/Unfreeze,
// Get Unique ID, Update Complete, Reset/Reboot, Factory Reset.
//
// All follow the same two-phase ACK-then-execute pattern as read/write, with
// the exception of Reset/Reboot which per MemoryConfigurationS §4.24 uses the
// subsequent Initialization Complete from the reboot as implicit ACK.

import {
    MTI_DATAGRAM,
    CONFIG_MEM_CONFIGURATION,
    CONFIG_MEM_OPTIONS_REPLY,
    CONFIG_MEM_RESERVE_LOCK_REPLY,
    CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_PRESENT,
    CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_NOT_PRESENT,
    CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO,
    CONFIG_MEM_SPACE_ALL,
    CONFIG_MEM_SPACE_CONFIGURATION_MEMORY,
    CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS,
    CONFIG_MEM_SPACE_ACDI_USER_ACCESS,
    CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO,
    CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY,
    CONFIG_MEM_SPACE_FIRMWARE,
    CONFIG_OPTIONS_COMMANDS_WRITE_UNDER_MASK,
    CONFIG_OPTIONS_COMMANDS_UNALIGNED_READS,
    CONFIG_OPTIONS_COMMANDS_UNALIGNED_WRITES,
    CONFIG_OPTIONS_COMMANDS_ACDI_MANUFACTURER_READ,
    CONFIG_OPTIONS_COMMANDS_ACDI_USER_READ,
    CONFIG_OPTIONS_COMMANDS_ACDI_USER_WRITE,
    CONFIG_OPTIONS_WRITE_LENGTH_RESERVED,
    CONFIG_OPTIONS_WRITE_LENGTH_STREAM_READ_WRITE,
    CONFIG_OPTIONS_SPACE_INFO_FLAG_READ_ONLY,
    CONFIG_OPTIONS_SPACE_INFO_FLAG_USE_LOW_ADDRESS,
    ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN,
} from '../openlcb/defines.js';
import {
    loadOpenlcbMessage,
    copyByteToPayload,
    copyWordToPayload,
    copyDwordToPayload,
    copyNodeIdToPayload,
    copyStringToPayload,
    extractNodeIdFromPayload,
} from '../openlcb/utilities.js';

/** Map the requested space byte to the corresponding addressSpace* field. */
function decodeSpaceInfo(sm, offset) {
    const byte = sm.incoming.msg.payload[offset];
    const p = sm.node.parameters;
    switch (byte) {
        case CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO:    return p.addressSpaceConfigurationDefinitionInfo;
        case CONFIG_MEM_SPACE_ALL:                              return p.addressSpaceAll;
        case CONFIG_MEM_SPACE_CONFIGURATION_MEMORY:             return p.addressSpaceConfigMemory;
        case CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS:         return p.addressSpaceAcdiManufacturer;
        case CONFIG_MEM_SPACE_ACDI_USER_ACCESS:                 return p.addressSpaceAcdiUser;
        case CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO:   return p.addressSpaceTrainFunctionDefinitionInfo;
        case CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY: return p.addressSpaceTrainFunctionConfigMemory;
        case CONFIG_MEM_SPACE_FIRMWARE:                         return p.addressSpaceFirmware;
        default:                                                return null;
    }
}

function loadReplyHeader(sm) {
    sm.outgoing.msg.payloadCount = 0;
    loadOpenlcbMessage(
        sm.outgoing.msg,
        sm.node.alias, sm.node.id,
        sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
        MTI_DATAGRAM
    );
    copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_CONFIGURATION, 0);
    sm.outgoing.valid = false;
}

// =============================================================================

export class ProtocolConfigMemOperations {
    /**
     * @param {Object} deps
     * @param {(sm, seconds) => void}    deps.loadDatagramReceivedOk required
     * @param {(sm, errorCode) => void}  deps.loadDatagramRejected   required
     * @param {Object} [deps.overrides] optional per-op handler overrides; keys:
     *                                  optionsCmd, getAddressSpaceInfo, unfreeze,
     *                                  freeze, reserveLock, getUniqueId,
     *                                  updateComplete, factoryReset, resetReboot,
     *                                  and `...Reply` variants.
     * @param {() => void} [deps.cleanupBeforeHandoff]  called pre-reboot / pre-firmware-handoff
     */
    constructor(deps = {}) {
        this._d = deps;
    }

    // -------------------------------------------------------------------------
    // Shared two-phase driver
    // -------------------------------------------------------------------------

    _runTwoPhase(sm, handler) {
        if (!sm.node.state.openlcbDatagramAckSent) {
            if (handler) {
                this._d.loadDatagramReceivedOk(sm, 0);
                sm.node.state.openlcbDatagramAckSent = true;
                sm.incoming.enumerate = true;
            } else {
                this._d.loadDatagramRejected(sm, ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN);
                sm.node.state.openlcbDatagramAckSent = false;
                sm.incoming.enumerate = false;
            }
            return;
        }
        handler(sm);
        sm.node.state.openlcbDatagramAckSent = false;
        sm.incoming.enumerate = false;
    }

    // -------------------------------------------------------------------------
    // Default handlers
    // -------------------------------------------------------------------------

    _defaultOptionsCmd(sm) {
        const params = sm.node.parameters;
        const opts = params.configurationOptions ?? {};

        let commandFlags = 0;
        if (opts.writeUnderMaskSupported)                   commandFlags |= CONFIG_OPTIONS_COMMANDS_WRITE_UNDER_MASK;
        if (opts.unalignedReadsSupported)                   commandFlags |= CONFIG_OPTIONS_COMMANDS_UNALIGNED_READS;
        if (opts.unalignedWritesSupported)                  commandFlags |= CONFIG_OPTIONS_COMMANDS_UNALIGNED_WRITES;
        if (opts.readFromManufacturerSpace0xFcSupported)    commandFlags |= CONFIG_OPTIONS_COMMANDS_ACDI_MANUFACTURER_READ;
        if (opts.readFromUserSpace0xFbSupported)            commandFlags |= CONFIG_OPTIONS_COMMANDS_ACDI_USER_READ;
        if (opts.writeToUserSpace0xFbSupported)             commandFlags |= CONFIG_OPTIONS_COMMANDS_ACDI_USER_WRITE;

        let writeFlags = CONFIG_OPTIONS_WRITE_LENGTH_RESERVED;
        if (opts.streamReadWriteSupported) writeFlags |= CONFIG_OPTIONS_WRITE_LENGTH_STREAM_READ_WRITE;

        loadReplyHeader(sm);
        copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_OPTIONS_REPLY, 1);
        copyWordToPayload(sm.outgoing.msg, commandFlags, 2);
        copyByteToPayload(sm.outgoing.msg, writeFlags, 4);
        copyByteToPayload(sm.outgoing.msg, opts.highAddressSpace ?? 0xFF, 5);
        copyByteToPayload(sm.outgoing.msg, opts.lowAddressSpace ?? 0xFB, 6);

        const desc = opts.description ?? '';
        if (desc.length > 0) {
            copyStringToPayload(sm.outgoing.msg, desc, sm.outgoing.msg.payloadCount);
        }
        sm.outgoing.valid = true;
    }

    _defaultGetAddressSpaceInfo(sm) {
        const spaceInfo = decodeSpaceInfo(sm, 2);
        loadReplyHeader(sm);

        if (spaceInfo && spaceInfo.present) {
            copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_PRESENT, 1);
            copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[2], 2);
            copyDwordToPayload(sm.outgoing.msg, spaceInfo.highestAddress, 3);

            let flags = 0;
            if (spaceInfo.readOnly)         flags |= CONFIG_OPTIONS_SPACE_INFO_FLAG_READ_ONLY;
            if (spaceInfo.lowAddressValid)  flags |= CONFIG_OPTIONS_SPACE_INFO_FLAG_USE_LOW_ADDRESS;
            copyByteToPayload(sm.outgoing.msg, flags, 7);

            let descOffset = 8;
            if (spaceInfo.lowAddressValid) {
                copyDwordToPayload(sm.outgoing.msg, spaceInfo.lowAddress, 8);
                descOffset = 12;
            }
            if (spaceInfo.description && spaceInfo.description.length > 0) {
                copyStringToPayload(sm.outgoing.msg, spaceInfo.description, descOffset);
            }
        } else {
            copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_NOT_PRESENT, 1);
            copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[2], 2);
            sm.outgoing.msg.payloadCount = 8;
        }
        sm.outgoing.valid = true;
    }

    _defaultReserveLock(sm) {
        const newNodeId = extractNodeIdFromPayload(sm.incoming.msg, 2);

        if (sm.node.ownerNode === 0n) {
            sm.node.ownerNode = newNodeId;
        } else if (newNodeId === 0n || newNodeId === sm.node.ownerNode) {
            sm.node.ownerNode = 0n;
        }

        loadReplyHeader(sm);
        copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_RESERVE_LOCK_REPLY, 1);
        copyNodeIdToPayload(sm.outgoing.msg, sm.node.ownerNode, 2);
        sm.outgoing.valid = true;
    }

    // -------------------------------------------------------------------------
    // Public entry points
    // -------------------------------------------------------------------------

    optionsCmd(sm) {
        this._runTwoPhase(sm, this._d.overrides?.optionsCmd ?? this._defaultOptionsCmd.bind(this));
    }

    optionsReply(sm) {
        this._runTwoPhase(sm, this._d.overrides?.optionsReply ?? null);
    }

    getAddressSpaceInfo(sm) {
        this._runTwoPhase(sm, this._d.overrides?.getAddressSpaceInfo ?? this._defaultGetAddressSpaceInfo.bind(this));
    }

    getAddressSpaceInfoReplyNotPresent(sm) {
        this._runTwoPhase(sm, this._d.overrides?.getAddressSpaceInfoReplyNotPresent ?? null);
    }

    getAddressSpaceInfoReplyPresent(sm) {
        this._runTwoPhase(sm, this._d.overrides?.getAddressSpaceInfoReplyPresent ?? null);
    }

    unfreeze(sm) {
        this._runTwoPhase(sm, this._d.overrides?.unfreeze ?? null);
    }

    freeze(sm) {
        // For firmware-space freeze the app cleanup hook fires at the start of
        // phase 2 (C: cleanup_before_handoff). We preserve that wiring.
        const spaceInfo = decodeSpaceInfo(sm, 2);
        const handler = this._d.overrides?.freeze ?? null;
        if (sm.node.state.openlcbDatagramAckSent &&
            spaceInfo && spaceInfo.addressSpace === CONFIG_MEM_SPACE_FIRMWARE &&
            this._d.cleanupBeforeHandoff) {
            this._d.cleanupBeforeHandoff();
        }
        this._runTwoPhase(sm, handler);
    }

    reserveLock(sm) {
        this._runTwoPhase(sm, this._d.overrides?.reserveLock ?? this._defaultReserveLock.bind(this));
    }

    reserveLockReply(sm) {
        this._runTwoPhase(sm, this._d.overrides?.reserveLockReply ?? null);
    }

    getUniqueId(sm) {
        this._runTwoPhase(sm, this._d.overrides?.getUniqueId ?? null);
    }

    getUniqueIdReply(sm) {
        this._runTwoPhase(sm, this._d.overrides?.getUniqueIdReply ?? null);
    }

    updateComplete(sm) {
        this._runTwoPhase(sm, this._d.overrides?.updateComplete ?? null);
    }

    factoryReset(sm) {
        this._runTwoPhase(sm, this._d.overrides?.factoryReset ?? null);
    }

    /**
     * Reset/Reboot — no ACK; the subsequent Initialization Complete serves as
     * acknowledgment per MemoryConfigurationS §4.24.
     */
    resetReboot(sm) {
        const handler = this._d.overrides?.resetReboot ?? null;
        if (!handler) {
            this._d.loadDatagramRejected(sm, ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN);
            return;
        }
        sm.outgoing.valid = false;
        if (this._d.cleanupBeforeHandoff) this._d.cleanupBeforeHandoff();
        handler(sm);
        sm.node.state.openlcbDatagramAckSent = false;
        sm.incoming.enumerate = false;
    }
}

// Ported from OpenLcbCLib/src/openlcb/protocol_datagram_handler.[hc].
//
// Datagram protocol — reliable 0..72 byte addressed transfers. Routes
// incoming datagrams to per-address-space callbacks and handles
// Datagram Received OK / Rejected replies with retry logic.
//
// The C port uses a 400-line manual switch-of-switches on payload[1]/[6].
// The JS port compresses that into a single dispatch table keyed by the
// numeric sub-command; missing callbacks fall through to an automatic
// Datagram Rejected with SUBCOMMAND_UNKNOWN, matching C behavior.

import {
    MTI_DATAGRAM_OK_REPLY,
    MTI_DATAGRAM_REJECTED_REPLY,
    CONFIG_MEM_CONFIGURATION,
    CONFIG_MEM_READ_SPACE_IN_BYTE_6, CONFIG_MEM_READ_SPACE_FD, CONFIG_MEM_READ_SPACE_FE, CONFIG_MEM_READ_SPACE_FF,
    CONFIG_MEM_READ_REPLY_OK_SPACE_IN_BYTE_6, CONFIG_MEM_READ_REPLY_OK_SPACE_FD, CONFIG_MEM_READ_REPLY_OK_SPACE_FE, CONFIG_MEM_READ_REPLY_OK_SPACE_FF,
    CONFIG_MEM_READ_REPLY_FAIL_SPACE_IN_BYTE_6, CONFIG_MEM_READ_REPLY_FAIL_SPACE_FD, CONFIG_MEM_READ_REPLY_FAIL_SPACE_FE, CONFIG_MEM_READ_REPLY_FAIL_SPACE_FF,
    CONFIG_MEM_READ_STREAM_SPACE_IN_BYTE_6, CONFIG_MEM_READ_STREAM_SPACE_FD, CONFIG_MEM_READ_STREAM_SPACE_FE, CONFIG_MEM_READ_STREAM_SPACE_FF,
    CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_IN_BYTE_6, CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FD, CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FE, CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FF,
    CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_IN_BYTE_6, CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FD, CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FE, CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FF,
    CONFIG_MEM_WRITE_SPACE_IN_BYTE_6, CONFIG_MEM_WRITE_SPACE_FD, CONFIG_MEM_WRITE_SPACE_FE, CONFIG_MEM_WRITE_SPACE_FF,
    CONFIG_MEM_WRITE_REPLY_OK_SPACE_IN_BYTE_6, CONFIG_MEM_WRITE_REPLY_OK_SPACE_FD, CONFIG_MEM_WRITE_REPLY_OK_SPACE_FE, CONFIG_MEM_WRITE_REPLY_OK_SPACE_FF,
    CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_IN_BYTE_6, CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FD, CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FE, CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FF,
    CONFIG_MEM_WRITE_UNDER_MASK_SPACE_IN_BYTE_6, CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FD, CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FE, CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FF,
    CONFIG_MEM_WRITE_STREAM_SPACE_IN_BYTE_6, CONFIG_MEM_WRITE_STREAM_SPACE_FD, CONFIG_MEM_WRITE_STREAM_SPACE_FE, CONFIG_MEM_WRITE_STREAM_SPACE_FF,
    CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_IN_BYTE_6, CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FD, CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FE, CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FF,
    CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_IN_BYTE_6, CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FD, CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FE, CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FF,
    CONFIG_MEM_OPTIONS_CMD, CONFIG_MEM_OPTIONS_REPLY,
    CONFIG_MEM_GET_ADDRESS_SPACE_INFO_CMD, CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_NOT_PRESENT, CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_PRESENT,
    CONFIG_MEM_RESERVE_LOCK, CONFIG_MEM_RESERVE_LOCK_REPLY,
    CONFIG_MEM_GET_UNIQUE_ID, CONFIG_MEM_GET_UNIQUE_ID_REPLY,
    CONFIG_MEM_UNFREEZE, CONFIG_MEM_FREEZE, CONFIG_MEM_UPDATE_COMPLETE,
    CONFIG_MEM_RESET_REBOOT, CONFIG_MEM_FACTORY_RESET,
    CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO,
    CONFIG_MEM_SPACE_ALL,
    CONFIG_MEM_SPACE_CONFIGURATION_MEMORY,
    CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS,
    CONFIG_MEM_SPACE_ACDI_USER_ACCESS,
    CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO,
    CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY,
    CONFIG_MEM_SPACE_FIRMWARE,
    DATAGRAM_OK_REPLY_PENDING,
    ERROR_TEMPORARY,
    ERROR_PERMANENT_NOT_IMPLEMENTED_COMMAND_UNKNOWN,
    ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN,
    DATAGRAM_TIMEOUT_ENUM_KEY,
} from '../openlcb/defines.js';
import {
    loadOpenlcbMessage,
    copyByteToPayload,
    copyWordToPayload,
    extractWordFromPayload,
} from '../openlcb/utilities.js';

const DATAGRAM_TIMEOUT_TICKS = 30;
const DATAGRAM_MAX_RETRIES = 3;

// Maps sub-command byte → descriptor {op, space}.
//   op: one of 'read' | 'readReplyOk' | 'readReplyFail'
//             | 'readStream' | 'readStreamReplyOk' | 'readStreamReplyFail'
//             | 'write' | 'writeReplyOk' | 'writeReplyFail'
//             | 'writeUnderMask'
//             | 'writeStream' | 'writeStreamReplyOk' | 'writeStreamReplyFail'
//             | 'options' | 'optionsReply'
//             | 'getAddressSpaceInfo' | 'getAddressSpaceInfoReplyNotPresent' | 'getAddressSpaceInfoReplyPresent'
//             | 'reserveLock' | 'reserveLockReply'
//             | 'getUniqueId' | 'getUniqueIdReply'
//             | 'unfreeze' | 'freeze' | 'updateComplete' | 'resetReboot' | 'factoryReset'
//   space:   'inByte6' | 'FD' | 'FE' | 'FF' | null  (null for non-address-space ops)
const SUBCOMMAND_TABLE = new Map([
    // Read (datagram transport)
    [CONFIG_MEM_READ_SPACE_IN_BYTE_6,          { op: 'read',               space: 'inByte6' }],
    [CONFIG_MEM_READ_SPACE_FD,                 { op: 'read',               space: 'FD' }],
    [CONFIG_MEM_READ_SPACE_FE,                 { op: 'read',               space: 'FE' }],
    [CONFIG_MEM_READ_SPACE_FF,                 { op: 'read',               space: 'FF' }],
    [CONFIG_MEM_READ_REPLY_OK_SPACE_IN_BYTE_6, { op: 'readReplyOk',        space: 'inByte6' }],
    [CONFIG_MEM_READ_REPLY_OK_SPACE_FD,        { op: 'readReplyOk',        space: 'FD' }],
    [CONFIG_MEM_READ_REPLY_OK_SPACE_FE,        { op: 'readReplyOk',        space: 'FE' }],
    [CONFIG_MEM_READ_REPLY_OK_SPACE_FF,        { op: 'readReplyOk',        space: 'FF' }],
    [CONFIG_MEM_READ_REPLY_FAIL_SPACE_IN_BYTE_6, { op: 'readReplyFail',    space: 'inByte6' }],
    [CONFIG_MEM_READ_REPLY_FAIL_SPACE_FD,      { op: 'readReplyFail',      space: 'FD' }],
    [CONFIG_MEM_READ_REPLY_FAIL_SPACE_FE,      { op: 'readReplyFail',      space: 'FE' }],
    [CONFIG_MEM_READ_REPLY_FAIL_SPACE_FF,      { op: 'readReplyFail',      space: 'FF' }],

    // Read (stream transport)
    [CONFIG_MEM_READ_STREAM_SPACE_IN_BYTE_6,   { op: 'readStream',         space: 'inByte6' }],
    [CONFIG_MEM_READ_STREAM_SPACE_FD,          { op: 'readStream',         space: 'FD' }],
    [CONFIG_MEM_READ_STREAM_SPACE_FE,          { op: 'readStream',         space: 'FE' }],
    [CONFIG_MEM_READ_STREAM_SPACE_FF,          { op: 'readStream',         space: 'FF' }],
    [CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_IN_BYTE_6,   { op: 'readStreamReplyOk',   space: 'inByte6' }],
    [CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FD, { op: 'readStreamReplyOk',  space: 'FD' }],
    [CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FE, { op: 'readStreamReplyOk',  space: 'FE' }],
    [CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FF, { op: 'readStreamReplyOk',  space: 'FF' }],
    [CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_IN_BYTE_6, { op: 'readStreamReplyFail', space: 'inByte6' }],
    [CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FD, { op: 'readStreamReplyFail', space: 'FD' }],
    [CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FE, { op: 'readStreamReplyFail', space: 'FE' }],
    [CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FF, { op: 'readStreamReplyFail', space: 'FF' }],

    // Write (datagram transport)
    [CONFIG_MEM_WRITE_SPACE_IN_BYTE_6,         { op: 'write',              space: 'inByte6' }],
    [CONFIG_MEM_WRITE_SPACE_FD,                { op: 'write',              space: 'FD' }],
    [CONFIG_MEM_WRITE_SPACE_FE,                { op: 'write',              space: 'FE' }],
    [CONFIG_MEM_WRITE_SPACE_FF,                { op: 'write',              space: 'FF' }],
    [CONFIG_MEM_WRITE_REPLY_OK_SPACE_IN_BYTE_6, { op: 'writeReplyOk',      space: 'inByte6' }],
    [CONFIG_MEM_WRITE_REPLY_OK_SPACE_FD,       { op: 'writeReplyOk',       space: 'FD' }],
    [CONFIG_MEM_WRITE_REPLY_OK_SPACE_FE,       { op: 'writeReplyOk',       space: 'FE' }],
    [CONFIG_MEM_WRITE_REPLY_OK_SPACE_FF,       { op: 'writeReplyOk',       space: 'FF' }],
    [CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_IN_BYTE_6, { op: 'writeReplyFail', space: 'inByte6' }],
    [CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FD,     { op: 'writeReplyFail',     space: 'FD' }],
    [CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FE,     { op: 'writeReplyFail',     space: 'FE' }],
    [CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FF,     { op: 'writeReplyFail',     space: 'FF' }],

    // Write under mask
    [CONFIG_MEM_WRITE_UNDER_MASK_SPACE_IN_BYTE_6, { op: 'writeUnderMask', space: 'inByte6' }],
    [CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FD,     { op: 'writeUnderMask',     space: 'FD' }],
    [CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FE,     { op: 'writeUnderMask',     space: 'FE' }],
    [CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FF,     { op: 'writeUnderMask',     space: 'FF' }],

    // Write (stream transport)
    [CONFIG_MEM_WRITE_STREAM_SPACE_IN_BYTE_6,  { op: 'writeStream',        space: 'inByte6' }],
    [CONFIG_MEM_WRITE_STREAM_SPACE_FD,         { op: 'writeStream',        space: 'FD' }],
    [CONFIG_MEM_WRITE_STREAM_SPACE_FE,         { op: 'writeStream',        space: 'FE' }],
    [CONFIG_MEM_WRITE_STREAM_SPACE_FF,         { op: 'writeStream',        space: 'FF' }],
    [CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_IN_BYTE_6, { op: 'writeStreamReplyOk', space: 'inByte6' }],
    [CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FD, { op: 'writeStreamReplyOk', space: 'FD' }],
    [CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FE, { op: 'writeStreamReplyOk', space: 'FE' }],
    [CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FF, { op: 'writeStreamReplyOk', space: 'FF' }],
    [CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_IN_BYTE_6, { op: 'writeStreamReplyFail', space: 'inByte6' }],
    [CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FD, { op: 'writeStreamReplyFail', space: 'FD' }],
    [CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FE, { op: 'writeStreamReplyFail', space: 'FE' }],
    [CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FF, { op: 'writeStreamReplyFail', space: 'FF' }],

    // Global config-memory operations — no space nibble.
    [CONFIG_MEM_OPTIONS_CMD,                              { op: 'options',                         space: null }],
    [CONFIG_MEM_OPTIONS_REPLY,                            { op: 'optionsReply',                    space: null }],
    [CONFIG_MEM_GET_ADDRESS_SPACE_INFO_CMD,               { op: 'getAddressSpaceInfo',             space: null }],
    [CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_NOT_PRESENT, { op: 'getAddressSpaceInfoReplyNotPresent', space: null }],
    [CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_PRESENT,     { op: 'getAddressSpaceInfoReplyPresent', space: null }],
    [CONFIG_MEM_RESERVE_LOCK,                             { op: 'reserveLock',                     space: null }],
    [CONFIG_MEM_RESERVE_LOCK_REPLY,                       { op: 'reserveLockReply',                space: null }],
    [CONFIG_MEM_GET_UNIQUE_ID,                            { op: 'getUniqueId',                     space: null }],
    [CONFIG_MEM_GET_UNIQUE_ID_REPLY,                      { op: 'getUniqueIdReply',                space: null }],
    [CONFIG_MEM_UNFREEZE,                                 { op: 'unfreeze',                        space: null }],
    [CONFIG_MEM_FREEZE,                                   { op: 'freeze',                          space: null }],
    [CONFIG_MEM_UPDATE_COMPLETE,                          { op: 'updateComplete',                  space: null }],
    [CONFIG_MEM_RESET_REBOOT,                             { op: 'resetReboot',                     space: null }],
    [CONFIG_MEM_FACTORY_RESET,                            { op: 'factoryReset',                    space: null }],
]);

/** Map payload[6] byte → canonical space key when the sub-command is "inByte6". */
function resolveSpaceByte(spaceByte) {
    switch (spaceByte) {
        case CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO:    return 'configDescriptionInfo';
        case CONFIG_MEM_SPACE_ALL:                              return 'all';
        case CONFIG_MEM_SPACE_CONFIGURATION_MEMORY:             return 'configurationMemory';
        case CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS:         return 'acdiManufacturer';
        case CONFIG_MEM_SPACE_ACDI_USER_ACCESS:                 return 'acdiUser';
        case CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO:   return 'trainFunctionDefinitionInfo';
        case CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY: return 'trainFunctionConfigMemory';
        case CONFIG_MEM_SPACE_FIRMWARE:                         return 'firmwareUpgrade';
        default:                                                return null;
    }
}

/** Map the "FD"/"FE"/"FF" space tag to its canonical name. */
function shortSpaceToName(tag) {
    switch (tag) {
        case 'FD': return 'configurationMemory';
        case 'FE': return 'all';
        case 'FF': return 'configDescriptionInfo';
        default:   return null;
    }
}

/** Compose the callback name: e.g. memoryReadSpaceAll. */
function callbackName(op, spaceName) {
    // Upper-case first letter of space name.
    const cap = spaceName.charAt(0).toUpperCase() + spaceName.slice(1);
    return `memory${op.charAt(0).toUpperCase() + op.slice(1)}Space${cap}`;
}

// -----------------------------------------------------------------------------
// Class
// -----------------------------------------------------------------------------

export class ProtocolDatagramHandler {
    /**
     * @param {Object} [deps]
     * @param {NodePool} [deps.nodePool] required for timeout scanning
     * @param {Object}   [deps.callbacks] memory-op callbacks keyed by `memoryReadSpaceAll`,
     *                                    `memoryWriteSpaceConfigurationMemory`, etc.
     *                                    Also: `memoryOptions`, `memoryFreeze`, …
     */
    constructor(deps = {}) {
        this._nodePool = deps.nodePool ?? null;
        this._cb = deps.callbacks ?? {};
    }

    // -------------------------------------------------------------------------
    // Outgoing reply builders
    // -------------------------------------------------------------------------

    /** @param {number} replyPendingTimeInSeconds 0 ⇒ no timeout; else rounded up to 2^N */
    loadDatagramReceivedOkMessage(sm, replyPendingTimeInSeconds) {
        let exponent = 0;
        if (replyPendingTimeInSeconds > 0) {
            // C uses a chain of if/else; same exponent. Clamp to 0x0F.
            exponent = Math.min(15, Math.ceil(Math.log2(Math.max(2, replyPendingTimeInSeconds))));
        }

        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_DATAGRAM_OK_REPLY
        );
        copyByteToPayload(sm.outgoing.msg, exponent | DATAGRAM_OK_REPLY_PENDING, 0);
        sm.outgoing.valid = true;
    }

    loadDatagramRejectedMessage(sm, returnCode) {
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_DATAGRAM_REJECTED_REPLY
        );
        copyWordToPayload(sm.outgoing.msg, returnCode, 0);
        sm.outgoing.valid = true;
    }

    // -------------------------------------------------------------------------
    // Incoming: datagram / datagram OK / datagram rejected
    // -------------------------------------------------------------------------

    /** Dispatch an incoming datagram to its handler, or reject. */
    handleDatagram(sm) {
        const p0 = sm.incoming.msg.payload[0];
        if (p0 !== CONFIG_MEM_CONFIGURATION) {
            this.loadDatagramRejectedMessage(sm, ERROR_PERMANENT_NOT_IMPLEMENTED_COMMAND_UNKNOWN);
            return;
        }

        const subCmd = sm.incoming.msg.payload[1];
        const descriptor = SUBCOMMAND_TABLE.get(subCmd);
        if (!descriptor) {
            this.loadDatagramRejectedMessage(sm, ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN);
            return;
        }

        // Resolve callback name.
        let cbName;
        if (descriptor.space === null) {
            // Global ops: memoryOptions, memoryFreeze, …
            cbName = `memory${descriptor.op.charAt(0).toUpperCase() + descriptor.op.slice(1)}`;
        } else {
            let spaceName;
            if (descriptor.space === 'inByte6') {
                spaceName = resolveSpaceByte(sm.incoming.msg.payload[6]);
                if (!spaceName) {
                    this.loadDatagramRejectedMessage(sm, ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN);
                    return;
                }
            } else {
                spaceName = shortSpaceToName(descriptor.space);
            }
            cbName = callbackName(descriptor.op, spaceName);
        }

        const handler = this._cb[cbName];
        if (!handler) {
            this.loadDatagramRejectedMessage(sm, ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN);
            return;
        }
        handler(sm);
    }

    /** Acknowledgement — clear resend / free buffer. */
    handleDatagramReceivedOk(sm) {
        this.clearResendDatagramMessage(sm.node);
        sm.outgoing.valid = false;
    }

    /**
     * Negative reply — if temporary, mark the stored datagram for resend
     * (up to DATAGRAM_MAX_RETRIES). On permanent errors or max retries, free.
     */
    handleDatagramRejected(sm) {
        const errorCode = extractWordFromPayload(sm.incoming.msg, 0);
        if ((errorCode & ERROR_TEMPORARY) === ERROR_TEMPORARY) {
            const last = sm.node.lastReceivedDatagram;
            if (last) {
                const retries = (last.timer.retryCount ?? 0) + 1;
                if (retries < DATAGRAM_MAX_RETRIES) {
                    last.timer.retryCount = retries;
                    last.timer.tickSnapshot = sm.currentTick & 0x1F;
                    sm.node.state.resendDatagram = true;
                } else {
                    this.clearResendDatagramMessage(sm.node);
                }
            }
        } else {
            this.clearResendDatagramMessage(sm.node);
        }
        sm.outgoing.valid = false;
    }

    /** Free the stored datagram (if any) and clear the resend flag. */
    clearResendDatagramMessage(node) {
        node.lastReceivedDatagram = null;
        node.state.resendDatagram = false;
    }

    // -------------------------------------------------------------------------
    // Periodic timeout scan
    // -------------------------------------------------------------------------

    /**
     * Walk the node pool looking for stuck or retry-exhausted datagrams.
     * Call from the main loop with the current 100ms tick.
     */
    checkTimeouts(currentTick) {
        if (!this._nodePool) return;
        let node = this._nodePool.getFirst(DATAGRAM_TIMEOUT_ENUM_KEY);
        while (node) {
            const last = node.lastReceivedDatagram;
            if (last) {
                const snapshot = last.timer.tickSnapshot ?? 0;
                const retries  = last.timer.retryCount ?? 0;
                const elapsed = (currentTick - snapshot) & 0x1F;
                if (elapsed >= DATAGRAM_TIMEOUT_TICKS || retries >= DATAGRAM_MAX_RETRIES) {
                    node.lastReceivedDatagram = null;
                    node.state.resendDatagram = false;
                }
            }
            node = this._nodePool.getNext(DATAGRAM_TIMEOUT_ENUM_KEY);
        }
    }
}

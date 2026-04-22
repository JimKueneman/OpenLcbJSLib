// Ported from OpenLcbCLib/src/drivers/canbus/can_rx_message_handler.[hc].
//
// Reassembles incoming CAN frames into OpenLCB messages and handles CAN
// control frames (CID, RID, AMD, AME, AMR, error reports). Pushes completed
// OpenLCB messages to the OpenLCB RX FIFO and any outgoing CAN control replies
// to the CAN TX FIFO.
//
// Departures from the C port:
//   - Buffer pools are gone: messages are allocated with createMessage() /
//     createCanMsg() on demand.
//   - openlcb_buffer_list (tracker of in-progress multi-frame assembly) is
//     replaced by an internal Map keyed by (sourceAlias, destAlias, mti).
//   - Dependencies are passed explicitly to the constructor rather than via a
//     global init function.

import {
    RESERVED_TOP_BIT,
    CAN_CONTROL_FRAME_AMR,
    CAN_CONTROL_FRAME_AMD,
    CAN_CONTROL_FRAME_RID,
    MTI_DATAGRAM,
    MTI_DATAGRAM_REJECTED_REPLY,
    MTI_OPTIONAL_INTERACTION_REJECTED,
    MTI_TRAIN_PROTOCOL,
    TRAIN_LISTENER_CONFIG,
    TRAIN_LISTENER_ATTACH,
    ERROR_TEMPORARY_OUT_OF_ORDER_MIDDLE_END_WITH_NO_START,
    ERROR_TEMPORARY_OUT_OF_ORDER_START_BEFORE_LAST_END,
    ERROR_TEMPORARY_BUFFER_UNAVAILABLE,
} from '../../openlcb/defines.js';
import { PAYLOAD_TYPE, createMessage } from '../../openlcb/types.js';
import {
    loadOpenlcbMessage,
    copyWordToPayload,
    extractByteFromPayload,
    extractNodeIdFromPayload,
} from '../../openlcb/utilities.js';
import { createCanMsg } from './types.js';
import {
    extractSourceAliasFromCanIdentifier,
    extractDestAliasFromCanMessage,
    extractCanPayloadAsNodeId,
    convertCanMtiToOpenlcbMti,
    appendCanPayloadToOpenlcbPayload,
    countNullsInPayloads,
    copyNodeIdToCanPayload,
} from './utilities.js';

/** Multi-frame assembly timeout in 100ms ticks. Same as C (3 seconds). */
const CAN_RX_INPROCESS_TIMEOUT_TICKS = 30;

/**
 * Compose the three-part key used to look up an in-progress assembly. The
 * C port walks an array; a packed Number keys a Map just as well and lets us
 * reuse the stock Map implementation.
 */
function assemblyKey(sourceAlias, destAlias, mti) {
    // 12 + 12 + 16 = 40 bits — safely inside Number.MAX_SAFE_INTEGER (2^53).
    return (sourceAlias * 0x10000000) + (destAlias * 0x10000) + mti;
}

export class CanRxMessageHandler {
    /**
     * @param {Object} deps
     * @param {AliasMappings}   deps.aliasMappings        required
     * @param {CanBufferFifo}   deps.canTxFifo            required — where AMR/AMD/RID control replies go
     * @param {MessageFifo}     deps.openlcbFifo          required — where completed OpenLCB messages go
     * @param {() => number}    deps.getCurrentTick       required — current 100ms tick (0-255)
     * @param {AliasMappingListener} [deps.listener]      optional — listener alias table
     */
    constructor(deps) {
        this._aliasMappings = deps.aliasMappings;
        this._canTxFifo = deps.canTxFifo;
        this._openlcbFifo = deps.openlcbFifo;
        this._getCurrentTick = deps.getCurrentTick;
        this._listener = deps.listener ?? null;
        /** @type {Map<number, Object>} in-progress multi-frame assemblies */
        this._inProcess = new Map();
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    _pushReject(sourceAlias, destAlias, originalMti, errorCode) {
        const reply = createMessage({ payloadType: PAYLOAD_TYPE.BASIC });
        const mti = originalMti === MTI_DATAGRAM
            ? MTI_DATAGRAM_REJECTED_REPLY
            : MTI_OPTIONAL_INTERACTION_REJECTED;
        loadOpenlcbMessage(reply, sourceAlias, 0n, destAlias, 0n, mti);
        copyWordToPayload(reply, destAlias, 0);
        copyWordToPayload(reply, errorCode, 2);
        this._openlcbFifo.push(reply);
    }

    /** Returns true if we saw the remote source alias duplicate one of ours. */
    _checkForDuplicateAlias(canMsg) {
        const sourceAlias = extractSourceAliasFromCanIdentifier(canMsg);
        const mapping = this._aliasMappings.findMappingByAlias(sourceAlias);
        if (!mapping) return false;

        mapping.isDuplicate = true;
        this._aliasMappings.setHasDuplicateAliasFlag();

        if (mapping.isPermitted) {
            const out = createCanMsg();
            out.identifier = (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_AMR | sourceAlias) >>> 0;
            copyNodeIdToCanPayload(out, mapping.nodeId, 0);
            this._canTxFifo.push(out);
        }
        return true;
    }

    // -------------------------------------------------------------------------
    // Multi-frame OpenLCB messages
    // -------------------------------------------------------------------------

    firstFrame(canMsg, offset, payloadType) {
        const destAlias = extractDestAliasFromCanMessage(canMsg);
        const sourceAlias = extractSourceAliasFromCanIdentifier(canMsg);
        const mti = convertCanMtiToOpenlcbMti(canMsg);
        const key = assemblyKey(sourceAlias, destAlias, mti);

        if (this._inProcess.has(key)) {
            // Out-of-order: a new first-frame before the previous end.
            this._pushReject(destAlias, sourceAlias, mti, ERROR_TEMPORARY_OUT_OF_ORDER_START_BEFORE_LAST_END);
            return;
        }

        const msg = createMessage({ payloadType });
        if (!msg) {
            // JS allocation is unfillable in practice; kept for parity.
            this._pushReject(destAlias, sourceAlias, mti, ERROR_TEMPORARY_BUFFER_UNAVAILABLE);
            return;
        }

        loadOpenlcbMessage(msg, sourceAlias, 0n, destAlias, 0n, mti);
        msg.timer.assemblyTicks = this._getCurrentTick();
        msg.state.inprocess = true;
        appendCanPayloadToOpenlcbPayload(msg, canMsg, offset);
        this._inProcess.set(key, msg);
    }

    middleFrame(canMsg, offset) {
        const destAlias = extractDestAliasFromCanMessage(canMsg);
        const sourceAlias = extractSourceAliasFromCanIdentifier(canMsg);
        const mti = convertCanMtiToOpenlcbMti(canMsg);
        const key = assemblyKey(sourceAlias, destAlias, mti);

        const msg = this._inProcess.get(key);
        if (!msg) {
            this._pushReject(destAlias, sourceAlias, mti, ERROR_TEMPORARY_OUT_OF_ORDER_MIDDLE_END_WITH_NO_START);
            return;
        }

        const elapsed = (this._getCurrentTick() - msg.timer.assemblyTicks) & 0xFF;
        if (elapsed >= CAN_RX_INPROCESS_TIMEOUT_TICKS) {
            this._inProcess.delete(key);
            this._pushReject(destAlias, sourceAlias, mti, ERROR_TEMPORARY_OUT_OF_ORDER_MIDDLE_END_WITH_NO_START);
            return;
        }

        appendCanPayloadToOpenlcbPayload(msg, canMsg, offset);
    }

    lastFrame(canMsg, offset) {
        const destAlias = extractDestAliasFromCanMessage(canMsg);
        const sourceAlias = extractSourceAliasFromCanIdentifier(canMsg);
        const mti = convertCanMtiToOpenlcbMti(canMsg);
        const key = assemblyKey(sourceAlias, destAlias, mti);

        const msg = this._inProcess.get(key);
        if (!msg) {
            this._pushReject(destAlias, sourceAlias, mti, ERROR_TEMPORARY_OUT_OF_ORDER_MIDDLE_END_WITH_NO_START);
            return;
        }

        appendCanPayloadToOpenlcbPayload(msg, canMsg, offset);
        msg.state.inprocess = false;
        this._inProcess.delete(key);
        this._openlcbFifo.push(msg);
    }

    singleFrame(canMsg, offset, payloadType) {
        const destAlias = extractDestAliasFromCanMessage(canMsg);
        const sourceAlias = extractSourceAliasFromCanIdentifier(canMsg);
        const mti = convertCanMtiToOpenlcbMti(canMsg);

        const msg = createMessage({ payloadType });
        loadOpenlcbMessage(msg, sourceAlias, 0n, destAlias, 0n, mti);
        appendCanPayloadToOpenlcbPayload(msg, canMsg, offset);
        this._openlcbFifo.push(msg);
    }

    streamFrame(canMsg, offset, payloadType) {
        const destAlias = extractDestAliasFromCanMessage(canMsg);
        const sourceAlias = extractSourceAliasFromCanIdentifier(canMsg);
        const mti = convertCanMtiToOpenlcbMti(canMsg);

        const msg = createMessage({ payloadType });
        loadOpenlcbMessage(msg, sourceAlias, 0n, destAlias, 0n, mti);
        // Per StreamTransportS: byte 0 is the DID; copy entire CAN payload from offset 0.
        appendCanPayloadToOpenlcbPayload(msg, canMsg, 0);
        this._openlcbFifo.push(msg);
    }

    /**
     * Legacy SNIP reassembly — messages arrive without multi-frame framing
     * bits, so completion is detected by counting NULL terminators.
     */
    canLegacySnip(canMsg, offset, payloadType) {
        const destAlias = extractDestAliasFromCanMessage(canMsg);
        const sourceAlias = extractSourceAliasFromCanIdentifier(canMsg);
        const mti = convertCanMtiToOpenlcbMti(canMsg);
        const key = assemblyKey(sourceAlias, destAlias, mti);

        const msg = this._inProcess.get(key);
        if (!msg) {
            this.firstFrame(canMsg, offset, payloadType);
            return;
        }

        if (countNullsInPayloads(msg, canMsg) < 6) {
            this.middleFrame(canMsg, offset);
        } else {
            this.lastFrame(canMsg, offset);
        }
    }

    // -------------------------------------------------------------------------
    // CAN control frames
    // -------------------------------------------------------------------------

    cidFrame(canMsg) {
        if (!canMsg) return;

        // Per CanFrameTransferS §6.2.5: reply to a CID with a RID if we own the
        // alias, regardless of permitted/inhibited state.
        const sourceAlias = extractSourceAliasFromCanIdentifier(canMsg);
        const mapping = this._aliasMappings.findMappingByAlias(sourceAlias);
        if (!mapping) return;

        const reply = createCanMsg();
        reply.identifier = (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_RID | sourceAlias) >>> 0;
        reply.payloadCount = 0;
        this._canTxFifo.push(reply);
    }

    ridFrame(canMsg) {
        this._checkForDuplicateAlias(canMsg);
    }

    /**
     * AMD: another node is mapping Node ID → alias. Two effects:
     *   1. Duplicate-alias detection against our own table.
     *   2. If the listener table is linked in, store the resolved alias and
     *      release any Train Listener Attach messages that were held waiting
     *      for this Node ID's alias.
     */
    amdFrame(canMsg) {
        this._checkForDuplicateAlias(canMsg);

        if (!this._listener) return;

        const nodeId = extractCanPayloadAsNodeId(canMsg);
        const alias = extractSourceAliasFromCanIdentifier(canMsg);
        this._listener.setAlias(nodeId, alias);
        this._releaseHeldMessagesForListener(nodeId);
    }

    _releaseHeldMessagesForListener(listenerId) {
        // Scan the in-progress assembly map for held listener-attach messages.
        for (const [key, msg] of this._inProcess) {
            if (!msg.state.inprocess) continue;
            if (msg.mti !== MTI_TRAIN_PROTOCOL) continue;

            const instruction = extractByteFromPayload(msg, 0);
            const subCommand  = extractByteFromPayload(msg, 1);
            if (instruction !== TRAIN_LISTENER_CONFIG) continue;
            if (subCommand !== TRAIN_LISTENER_ATTACH) continue;

            const heldListenerId = extractNodeIdFromPayload(msg, 3);
            if (heldListenerId !== listenerId) continue;

            msg.state.inprocess = false;
            this._inProcess.delete(key);
            this._openlcbFifo.push(msg);
        }
    }

    /**
     * AME: query for aliases. Non-empty payload = targeted query for a
     * specific Node ID; empty payload = global query.
     */
    ameFrame(canMsg) {
        if (this._checkForDuplicateAlias(canMsg)) return;

        if (canMsg.payloadCount > 0) {
            const mapping = this._aliasMappings.findMappingByNodeId(extractCanPayloadAsNodeId(canMsg));
            if (mapping && mapping.isPermitted) {
                const out = createCanMsg();
                out.identifier = (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_AMD | mapping.alias) >>> 0;
                copyNodeIdToCanPayload(out, mapping.nodeId, 0);
                this._canTxFifo.push(out);
            }
            return;
        }

        // Global AME: flush listener aliases per CanFrameTransferS §6.2.3, then
        // for every permitted local mapping, re-populate the listener table
        // and emit an AMD.
        if (this._listener) this._listener.flushAliases();

        for (const entry of this._aliasMappings.getList()) {
            if (entry.alias !== 0 && entry.isPermitted) {
                if (this._listener) this._listener.setAlias(entry.nodeId, entry.alias);
                const out = createCanMsg();
                out.identifier = (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_AMD | entry.alias) >>> 0;
                copyNodeIdToCanPayload(out, entry.nodeId, 0);
                this._canTxFifo.push(out);
            }
        }
    }

    /**
     * AMR: remote node releases its alias. Drop all in-progress assemblies
     * from that source, mark queued OpenLCB messages invalid so they're
     * discarded on pop, and clear the listener entry.
     */
    amrFrame(canMsg) {
        this._checkForDuplicateAlias(canMsg);

        const alias = extractSourceAliasFromCanIdentifier(canMsg);

        // Drop in-progress assemblies from this source.
        for (const [key, msg] of this._inProcess) {
            if (msg.sourceAlias === alias) this._inProcess.delete(key);
        }

        // Let MessageFifo invalidate queued incoming messages (if it's the class
        // from openlcb/message-fifo.js; otherwise this is a no-op).
        if (typeof this._openlcbFifo.checkAndInvalidateMessagesBySourceAlias === 'function') {
            this._openlcbFifo.checkAndInvalidateMessagesBySourceAlias(alias);
        }

        if (this._listener) this._listener.clearAliasByAlias(alias);
    }

    errorInfoReportFrame(canMsg) {
        this._checkForDuplicateAlias(canMsg);
    }
}

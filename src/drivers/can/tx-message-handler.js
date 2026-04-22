// Ported from OpenLcbCLib/src/drivers/canbus/can_tx_message_handler.[hc].
//
// Segments outgoing OpenLCB messages into CAN frames. Addressed and
// unaddressed (global) messages, datagrams (1..72 bytes), stream data, and
// raw CAN control frames. The destination transport (WebSocket/GridConnect)
// is injected as a `transmit(canMsg) => boolean` callback; the frame shape
// stays a can_msg_t so GridConnect encoding happens in one place (the
// WebSocket layer in Phase 7).

import {
    RESERVED_TOP_BIT,
    CAN_OPENLCB_MSG,
    OPENLCB_MESSAGE_STANDARD_FRAME_TYPE,
    CAN_FRAME_TYPE_DATAGRAM_ONLY,
    CAN_FRAME_TYPE_DATAGRAM_FIRST,
    CAN_FRAME_TYPE_DATAGRAM_MIDDLE,
    CAN_FRAME_TYPE_DATAGRAM_FINAL,
    CAN_FRAME_TYPE_STREAM,
    MULTIFRAME_ONLY,
    MULTIFRAME_FIRST,
    MULTIFRAME_MIDDLE,
    MULTIFRAME_FINAL,
} from '../../openlcb/defines.js';
import { setMultiFrameFlag } from '../../openlcb/utilities.js';
import {
    LEN_CAN_BYTE_ARRAY,
    OFFSET_CAN_WITHOUT_DEST_ADDRESS,
    OFFSET_CAN_WITH_DEST_ADDRESS,
} from './types.js';
import { copyOpenlcbPayloadToCanPayload } from './utilities.js';

// Pre-built upper-bit patterns for each identifier variant.
const DATAGRAM_ONLY   = (RESERVED_TOP_BIT | CAN_OPENLCB_MSG | CAN_FRAME_TYPE_DATAGRAM_ONLY)   >>> 0;
const DATAGRAM_FIRST  = (RESERVED_TOP_BIT | CAN_OPENLCB_MSG | CAN_FRAME_TYPE_DATAGRAM_FIRST)  >>> 0;
const DATAGRAM_MIDDLE = (RESERVED_TOP_BIT | CAN_OPENLCB_MSG | CAN_FRAME_TYPE_DATAGRAM_MIDDLE) >>> 0;
const DATAGRAM_LAST   = (RESERVED_TOP_BIT | CAN_OPENLCB_MSG | CAN_FRAME_TYPE_DATAGRAM_FINAL)  >>> 0;
const STANDARD_FRAME  = (RESERVED_TOP_BIT | CAN_OPENLCB_MSG | OPENLCB_MESSAGE_STANDARD_FRAME_TYPE) >>> 0;
const STREAM_FRAME_ID = (RESERVED_TOP_BIT | CAN_OPENLCB_MSG | CAN_FRAME_TYPE_STREAM) >>> 0;

function buildDatagramIdentifier(base, msg) {
    return (base | ((msg.destAlias & 0xFFF) << 12) | (msg.sourceAlias & 0xFFF)) >>> 0;
}

function buildStandardIdentifier(msg) {
    return (STANDARD_FRAME | ((msg.mti & 0x0FFF) << 12) | (msg.sourceAlias & 0xFFF)) >>> 0;
}

export class CanTxMessageHandler {
    /**
     * @param {Object} deps
     * @param {(canMsg: Object) => boolean} deps.transmit     required — hardware TX
     * @param {(canMsg: Object) => void}   [deps.onTransmit]  optional — post-TX hook
     */
    constructor(deps) {
        this._transmit = deps.transmit;
        this._onTransmit = deps.onTransmit ?? null;
    }

    _send(canMsg) {
        const ok = this._transmit(canMsg);
        if (ok && this._onTransmit) this._onTransmit(canMsg);
        return ok;
    }

    // -------------------------------------------------------------------------
    // Datagram — up to 72 bytes, automatic ONLY/FIRST/MIDDLE/LAST selection
    // -------------------------------------------------------------------------

    datagramFrame(openlcbMsg, canMsgWorker, indexRef) {
        const startIndex = indexRef.value;
        const len = copyOpenlcbPayloadToCanPayload(
            openlcbMsg, canMsgWorker, startIndex, OFFSET_CAN_WITHOUT_DEST_ADDRESS
        );

        let baseId;
        if (openlcbMsg.payloadCount <= LEN_CAN_BYTE_ARRAY) {
            baseId = DATAGRAM_ONLY;
        } else if (startIndex < LEN_CAN_BYTE_ARRAY) {
            baseId = DATAGRAM_FIRST;
        } else if (startIndex + len < openlcbMsg.payloadCount) {
            baseId = DATAGRAM_MIDDLE;
        } else {
            baseId = DATAGRAM_LAST;
        }

        canMsgWorker.identifier = buildDatagramIdentifier(baseId, openlcbMsg);
        const result = this._send(canMsgWorker);
        if (result) indexRef.value = startIndex + len;
        return result;
    }

    // -------------------------------------------------------------------------
    // Global (unaddressed) OpenLCB message — single frame only
    // -------------------------------------------------------------------------

    unaddressedMsgFrame(openlcbMsg, canMsgWorker, indexRef) {
        if (openlcbMsg.payloadCount > LEN_CAN_BYTE_ARRAY) {
            // PCER-with-Payload uses dedicated CAN MTIs (FIRST/MIDDLE/LAST);
            // no standard unaddressed message exceeds 8 bytes on this path.
            throw new Error('unaddressedMsgFrame: payload > 8 bytes (use PCER-with-payload path)');
        }

        const startIndex = indexRef.value;
        const len = copyOpenlcbPayloadToCanPayload(
            openlcbMsg, canMsgWorker, startIndex, OFFSET_CAN_WITHOUT_DEST_ADDRESS
        );
        canMsgWorker.identifier = buildStandardIdentifier(openlcbMsg);

        const result = this._send(canMsgWorker);
        if (result) indexRef.value = startIndex + len;
        return result;
    }

    // -------------------------------------------------------------------------
    // Addressed OpenLCB message — dest alias in payload[0..1], ONLY/FIRST/...
    // -------------------------------------------------------------------------

    addressedMsgFrame(openlcbMsg, canMsgWorker, indexRef) {
        // Write dest alias into the CAN payload first so copyOpenlcbPayload...
        // appends real data starting at byte 2.
        canMsgWorker.payload[0] = (openlcbMsg.destAlias >>> 8) & 0xFF;
        canMsgWorker.payload[1] =  openlcbMsg.destAlias        & 0xFF;
        canMsgWorker.identifier = buildStandardIdentifier(openlcbMsg);

        const startIndex = indexRef.value;
        const len = copyOpenlcbPayloadToCanPayload(
            openlcbMsg, canMsgWorker, startIndex, OFFSET_CAN_WITH_DEST_ADDRESS
        );

        // Selection mirrors C: 6 usable data bytes per frame after dest alias.
        let flag;
        if (openlcbMsg.payloadCount <= 6) {
            flag = MULTIFRAME_ONLY;
        } else if (startIndex < 6) {
            flag = MULTIFRAME_FIRST;
        } else if (startIndex + len < openlcbMsg.payloadCount) {
            flag = MULTIFRAME_MIDDLE;
        } else {
            flag = MULTIFRAME_FINAL;
        }
        setMultiFrameFlag(canMsgWorker.payload, 0, flag);

        const result = this._send(canMsgWorker);
        if (result) indexRef.value = startIndex + len;
        return result;
    }

    // -------------------------------------------------------------------------
    // Stream Data Send — DID (payload[0]) in CAN byte 0, data in bytes 1-7
    // -------------------------------------------------------------------------

    streamFrame(openlcbMsg, canMsgWorker, indexRef) {
        canMsgWorker.identifier = (
            STREAM_FRAME_ID |
            ((openlcbMsg.destAlias & 0xFFF) << 12) |
            (openlcbMsg.sourceAlias & 0xFFF)
        ) >>> 0;

        canMsgWorker.payload[0] = openlcbMsg.payload[0]; // DID always
        const startIndex = indexRef.value;
        // First call (startIndex == 0) skips the DID byte at payload[0] and
        // starts copying from payload[1]; later calls read from startIndex
        // directly because the DID was accounted for in the first advance.
        let src = startIndex === 0 ? 1 : startIndex;
        let count = 0;

        for (let i = 1; i < LEN_CAN_BYTE_ARRAY; i++) {
            if (src >= openlcbMsg.payloadCount) break;
            canMsgWorker.payload[i] = openlcbMsg.payload[src++];
            count++;
        }
        canMsgWorker.payloadCount = 1 + count;

        const result = this._send(canMsgWorker);
        if (result) {
            indexRef.value = startIndex === 0 ? 1 + count : startIndex + count;
        }
        return result;
    }

    // -------------------------------------------------------------------------
    // Raw CAN frame (CID/RID/AMD during login, already fully constructed)
    // -------------------------------------------------------------------------

    canFrame(canMsg) {
        return this._send(canMsg);
    }
}

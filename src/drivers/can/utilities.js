// Ported from OpenLcbCLib/src/drivers/canbus/can_utilities.[hc]
//
// Stateless helpers for building CAN frames, extracting fields from the
// 29-bit identifier, and translating between OpenLCB messages and CAN frames.

import {
    MASK_CAN_FRAME_TYPE,
    MASK_CAN_DEST_ADDRESS_PRESENT,
    OPENLCB_MESSAGE_STANDARD_FRAME_TYPE,
    CAN_FRAME_TYPE_STREAM,
    CAN_FRAME_TYPE_DATAGRAM_ONLY,
    CAN_FRAME_TYPE_DATAGRAM_FIRST,
    CAN_FRAME_TYPE_DATAGRAM_MIDDLE,
    CAN_FRAME_TYPE_DATAGRAM_FINAL,
    CAN_OPENLCB_MSG,
    MTI_PC_EVENT_REPORT_WITH_PAYLOAD,
    MTI_STREAM_SEND,
    MTI_DATAGRAM,
} from '../../openlcb/defines.js';
import {
    LEN_CAN_BYTE_ARRAY,
    CAN_MTI_PCER_WITH_PAYLOAD_FIRST,
    CAN_MTI_PCER_WITH_PAYLOAD_MIDDLE,
    CAN_MTI_PCER_WITH_PAYLOAD_LAST,
} from './types.js';
import { payloadTypeToLen } from '../../openlcb/utilities.js';

// =============================================================================
// Basic frame operations
// =============================================================================

export function clearCanMessage(canMsg) {
    canMsg.identifier = 0;
    canMsg.payloadCount = 0;
    canMsg.payload.fill(0);
}

/**
 * Load identifier, payload size, and up to 8 data bytes into a CAN frame.
 * `bytes` is any array-like (Uint8Array / number[]) of up to 8 bytes; shorter
 * arrays leave the remaining payload bytes at 0.
 */
export function loadCanMessage(canMsg, identifier, payloadSize, bytes = []) {
    canMsg.identifier = identifier >>> 0;
    canMsg.payloadCount = payloadSize;
    for (let i = 0; i < LEN_CAN_BYTE_ARRAY; i++) {
        canMsg.payload[i] = (i < bytes.length ? bytes[i] : 0) & 0xFF;
    }
}

/**
 * Copy a 48-bit Node ID (BigInt) into can_msg payload starting at startOffset.
 * Sets payloadCount to startOffset + 6. Returns bytes written, or 0 if
 * startOffset > 2.
 */
export function copyNodeIdToCanPayload(canMsg, nodeId, startOffset) {
    if (startOffset > 2) return 0;

    canMsg.payloadCount = 6 + startOffset;
    let v = BigInt.asUintN(48, nodeId);
    for (let i = startOffset + 5; i >= startOffset; i--) {
        canMsg.payload[i] = Number(v & 0xFFn);
        v >>= 8n;
    }
    return canMsg.payloadCount;
}

/**
 * Copy payload bytes from an OpenLCB message into a CAN frame starting at
 * canStartIndex. Returns the number of bytes copied. Updates the CAN frame's
 * payloadCount to (canStartIndex + bytesCopied).
 */
export function copyOpenlcbPayloadToCanPayload(openlcbMsg, canMsg, openlcbStartIndex, canStartIndex) {
    canMsg.payloadCount = 0;
    let count = 0;

    if (openlcbMsg.payloadCount === 0) return 0;

    let src = openlcbStartIndex;
    for (let i = canStartIndex; i < LEN_CAN_BYTE_ARRAY; i++) {
        canMsg.payload[i] = openlcbMsg.payload[src++];
        count++;
        if (src >= openlcbMsg.payloadCount) break;
    }

    canMsg.payloadCount = canStartIndex + count;
    return count;
}

/**
 * Append CAN payload bytes (from canStartIndex up to canMsg.payloadCount) onto
 * an OpenLCB message's payload. Stops if the OpenLCB buffer is full.
 * Updates openlcbMsg.payloadCount. Returns bytes copied.
 */
export function appendCanPayloadToOpenlcbPayload(openlcbMsg, canMsg, canStartIndex) {
    let result = 0;
    const bufferLen = payloadTypeToLen(openlcbMsg.payloadType);

    for (let i = canStartIndex; i < canMsg.payloadCount; i++) {
        if (openlcbMsg.payloadCount < bufferLen) {
            openlcbMsg.payload[openlcbMsg.payloadCount++] = canMsg.payload[i];
            result++;
        } else {
            break;
        }
    }
    return result;
}

/**
 * Copy a 64-bit BigInt (typically an Event ID) MSB-first into all 8 CAN
 * payload bytes. Sets payloadCount to 8.
 */
export function copy64BitToCanMessage(canMsg, data) {
    let v = BigInt.asUintN(64, data);
    for (let i = 7; i >= 0; i--) {
        canMsg.payload[i] = Number(v & 0xFFn);
        v >>= 8n;
    }
    canMsg.payloadCount = 8;
    return 8;
}

/** Copy identifier and valid payload bytes from source to target. State flags not copied. */
export function copyCanMessage(source, target) {
    target.identifier = source.identifier;
    for (let i = 0; i < source.payloadCount; i++) {
        target.payload[i] = source.payload[i];
    }
    target.payloadCount = source.payloadCount;
    return source.payloadCount;
}

// =============================================================================
// Identifier-field extraction
// =============================================================================

/** Read a 48-bit Node ID (BigInt) from can_msg payload bytes 0-5. */
export function extractCanPayloadAsNodeId(canMsg) {
    const p = canMsg.payload;
    return (
        (BigInt(p[0]) << 40n) |
        (BigInt(p[1]) << 32n) |
        (BigInt(p[2]) << 24n) |
        (BigInt(p[3]) << 16n) |
        (BigInt(p[4]) <<  8n) |
         BigInt(p[5])
    );
}

/** 12-bit source alias from identifier bits 0-11. */
export function extractSourceAliasFromCanIdentifier(canMsg) {
    return canMsg.identifier & 0xFFF;
}

/**
 * 12-bit destination alias. For standard addressed frames, pulled from
 * payload bytes 0-1 (high nibble of byte 0, full byte 1). For stream and
 * datagram frame types, pulled from identifier bits 12-23. 0 means global.
 */
export function extractDestAliasFromCanMessage(canMsg) {
    switch (canMsg.identifier & MASK_CAN_FRAME_TYPE) {
        case OPENLCB_MESSAGE_STANDARD_FRAME_TYPE:
            if (canMsg.identifier & MASK_CAN_DEST_ADDRESS_PRESENT) {
                return ((canMsg.payload[0] & 0x0F) << 8) | canMsg.payload[1];
            }
            return 0;

        case CAN_FRAME_TYPE_STREAM:
        case CAN_FRAME_TYPE_DATAGRAM_ONLY:
        case CAN_FRAME_TYPE_DATAGRAM_FIRST:
        case CAN_FRAME_TYPE_DATAGRAM_MIDDLE:
        case CAN_FRAME_TYPE_DATAGRAM_FINAL:
            return (canMsg.identifier >>> 12) & 0xFFF;

        default:
            return 0;
    }
}

/**
 * Convert the CAN frame type bits to a 16-bit OpenLCB MTI. Returns 0 for CAN
 * control frames (CID/RID/AMD/etc.). Multi-frame PCER-with-payload framing
 * MTIs collapse to MTI_PC_EVENT_REPORT_WITH_PAYLOAD.
 */
export function convertCanMtiToOpenlcbMti(canMsg) {
    switch (canMsg.identifier & MASK_CAN_FRAME_TYPE) {
        case OPENLCB_MESSAGE_STANDARD_FRAME_TYPE: {
            let mti = (canMsg.identifier >>> 12) & 0x0FFF;
            if (
                mti === CAN_MTI_PCER_WITH_PAYLOAD_FIRST ||
                mti === CAN_MTI_PCER_WITH_PAYLOAD_MIDDLE ||
                mti === CAN_MTI_PCER_WITH_PAYLOAD_LAST
            ) {
                mti = MTI_PC_EVENT_REPORT_WITH_PAYLOAD;
            }
            return mti;
        }
        case CAN_FRAME_TYPE_STREAM:
            return MTI_STREAM_SEND;

        case CAN_FRAME_TYPE_DATAGRAM_ONLY:
        case CAN_FRAME_TYPE_DATAGRAM_FIRST:
        case CAN_FRAME_TYPE_DATAGRAM_MIDDLE:
        case CAN_FRAME_TYPE_DATAGRAM_FINAL:
            return MTI_DATAGRAM;

        default:
            return 0;
    }
}

// =============================================================================
// Classification helpers
// =============================================================================

export function isOpenlcbMessage(canMsg) {
    return (canMsg.identifier & CAN_OPENLCB_MSG) === CAN_OPENLCB_MSG;
}

function countNullsInCanPayload(canMsg) {
    let count = 0;
    for (let i = 0; i < canMsg.payloadCount; i++) {
        if (canMsg.payload[i] === 0x00) count++;
    }
    return count;
}

function countNullsInOpenlcbPayload(openlcbMsg) {
    let count = 0;
    for (let i = 0; i < openlcbMsg.payloadCount; i++) {
        if (openlcbMsg.payload[i] === 0x00) count++;
    }
    return count;
}

/** SNIP completion check: 6 total NULL bytes across both payloads. */
export function countNullsInPayloads(openlcbMsg, canMsg) {
    return countNullsInCanPayload(canMsg) + countNullsInOpenlcbPayload(openlcbMsg);
}

// Ported from OpenLcbCLib/src/openlcb/openlcb_utilities.[hc]
//
// All multi-byte values follow OpenLCB big-endian (network byte order) ordering.
// Payload insert functions increment payloadCount; extract functions do not.
//
// Scope of this port: message structure helpers, big-endian payload
// insert/extract, message classification, multi-frame flag, event range
// utilities, and config-memory-buffer (Uint8Array) insert/extract.
// Config-memory reply builders live with the config-mem protocol handlers
// (Phase 5) since they depend on the statemachine context structure.

import {
    MASK_DEST_ADDRESS_PRESENT,
    LEN_MESSAGE_BYTES_BASIC,
    LEN_MESSAGE_BYTES_DATAGRAM,
    LEN_MESSAGE_BYTES_SNIP,
    LEN_MESSAGE_BYTES_STREAM,
    LEN_MESSAGE_BYTES_WORKER,
    MTI_DATAGRAM,
    CONFIG_MEM_CONFIGURATION,
    CONFIG_MEM_REPLY_OK_OFFSET,
    CONFIG_MEM_REPLY_FAIL_OFFSET,
} from './defines.js';
import { PAYLOAD_TYPE, ADDRESS_SPACE_ENCODING } from './types.js';

// =============================================================================
// Payload type → length
// =============================================================================

export function payloadTypeToLen(payloadType) {
    switch (payloadType) {
        case PAYLOAD_TYPE.BASIC:    return LEN_MESSAGE_BYTES_BASIC;
        case PAYLOAD_TYPE.DATAGRAM: return LEN_MESSAGE_BYTES_DATAGRAM;
        case PAYLOAD_TYPE.SNIP:     return LEN_MESSAGE_BYTES_SNIP;
        case PAYLOAD_TYPE.STREAM:   return LEN_MESSAGE_BYTES_STREAM;
        case PAYLOAD_TYPE.WORKER:   return LEN_MESSAGE_BYTES_WORKER;
        default:                    return 0;
    }
}

// =============================================================================
// Message structure operations
// =============================================================================

export function loadOpenlcbMessage(msg, sourceAlias, sourceId, destAlias, destId, mti) {
    msg.destAlias = destAlias;
    msg.destId = destId;
    msg.sourceAlias = sourceAlias;
    msg.sourceId = sourceId;
    msg.mti = mti;
    msg.payloadCount = 0;
    msg.timer.assemblyTicks = 0;
    msg.payload.fill(0);
}

export function clearOpenlcbMessagePayload(msg) {
    msg.payload.fill(0);
    msg.payloadCount = 0;
}

export function clearOpenlcbMessage(msg) {
    msg.destAlias = 0;
    msg.destId = 0n;
    msg.sourceAlias = 0;
    msg.sourceId = 0n;
    msg.mti = 0;
    msg.payloadCount = 0;
    msg.timer.assemblyTicks = 0;
    msg.referenceCount = 0;
    msg.state.allocated = false;
    msg.state.inprocess = false;
    msg.state.invalid = false;
}

// =============================================================================
// Payload insert (big-endian) — each increments payloadCount
// =============================================================================

export function copyEventIdToPayload(msg, eventId) {
    // eventId is BigInt; write 8 bytes big-endian at offset 0.
    let v = BigInt.asUintN(64, eventId);
    for (let i = 7; i >= 0; i--) {
        msg.payload[i] = Number(v & 0xFFn);
        v >>= 8n;
    }
    // C sets payload_count = 8 at the end regardless of initial value.
    msg.payloadCount = 8;
}

export function copyNodeIdToPayload(msg, nodeId, offset) {
    // nodeId is BigInt; write 6 bytes big-endian starting at offset.
    let v = BigInt.asUintN(48, nodeId);
    for (let i = 5; i >= 0; i--) {
        msg.payload[offset + i] = Number(v & 0xFFn);
        v >>= 8n;
        msg.payloadCount++;
    }
}

export function copyByteToPayload(msg, byte, offset) {
    msg.payload[offset] = byte & 0xFF;
    msg.payloadCount++;
}

export function copyWordToPayload(msg, word, offset) {
    msg.payload[offset]     = (word >>> 8) & 0xFF;
    msg.payload[offset + 1] = word & 0xFF;
    msg.payloadCount += 2;
}

export function copyDwordToPayload(msg, doubleword, offset) {
    msg.payload[offset]     = (doubleword >>> 24) & 0xFF;
    msg.payload[offset + 1] = (doubleword >>> 16) & 0xFF;
    msg.payload[offset + 2] = (doubleword >>> 8) & 0xFF;
    msg.payload[offset + 3] = doubleword & 0xFF;
    msg.payloadCount += 4;
}

/**
 * Copies a JS string into the payload as ASCII/Latin-1 bytes, always writing
 * a trailing null byte. Truncates at (payload length - 1) if needed. Returns
 * the number of bytes written including the null terminator.
 */
export function copyStringToPayload(msg, string, offset) {
    const payloadLen = payloadTypeToLen(msg.payloadType);
    let counter = 0;
    while (counter < string.length) {
        if ((counter + offset) < payloadLen - 1) {
            msg.payload[counter + offset] = string.charCodeAt(counter) & 0xFF;
            msg.payloadCount++;
            counter++;
        } else {
            break;
        }
    }
    msg.payload[counter + offset] = 0x00;
    msg.payloadCount++;
    counter++;
    return counter;
}

/**
 * Copies a byte array (Uint8Array or number[]) into the payload starting at
 * offset. May copy fewer bytes than requested if payload space is exhausted.
 * Returns the number of bytes actually written.
 */
export function copyByteArrayToPayload(msg, byteArray, offset, requestedBytes) {
    const payloadLen = payloadTypeToLen(msg.payloadType);
    let counter = 0;
    for (let i = 0; i < requestedBytes; i++) {
        if ((i + offset) < payloadLen) {
            msg.payload[i + offset] = byteArray[i] & 0xFF;
            msg.payloadCount++;
            counter++;
        } else {
            break;
        }
    }
    return counter;
}

// =============================================================================
// Payload extract (big-endian) — do not modify payloadCount
// =============================================================================

export function extractNodeIdFromPayload(msg, offset) {
    const p = msg.payload;
    return (
        (BigInt(p[offset])     << 40n) |
        (BigInt(p[offset + 1]) << 32n) |
        (BigInt(p[offset + 2]) << 24n) |
        (BigInt(p[offset + 3]) << 16n) |
        (BigInt(p[offset + 4]) << 8n)  |
         BigInt(p[offset + 5])
    );
}

export function extractEventIdFromPayload(msg) {
    const p = msg.payload;
    return (
        (BigInt(p[0]) << 56n) |
        (BigInt(p[1]) << 48n) |
        (BigInt(p[2]) << 40n) |
        (BigInt(p[3]) << 32n) |
        (BigInt(p[4]) << 24n) |
        (BigInt(p[5]) << 16n) |
        (BigInt(p[6]) << 8n)  |
         BigInt(p[7])
    );
}

export function extractByteFromPayload(msg, offset) {
    return msg.payload[offset];
}

export function extractWordFromPayload(msg, offset) {
    return ((msg.payload[offset] << 8) | msg.payload[offset + 1]) & 0xFFFF;
}

export function extractDwordFromPayload(msg, offset) {
    // Use >>> 0 at the end so the result is an unsigned 32-bit Number.
    return (
        (msg.payload[offset]     << 24) |
        (msg.payload[offset + 1] << 16) |
        (msg.payload[offset + 2] <<  8) |
         msg.payload[offset + 3]
    ) >>> 0;
}

// =============================================================================
// Message classification
// =============================================================================

export function setMultiFrameFlag(payload, offset, flag) {
    payload[offset] = (payload[offset] & 0x0F) | (flag & 0xF0);
}

export function isAddressedOpenlcbMessage(msg) {
    return (msg.mti & MASK_DEST_ADDRESS_PRESENT) === MASK_DEST_ADDRESS_PRESENT;
}

export function isAddressedMessageForNode(node, msg) {
    return node.alias === msg.destAlias || node.id === msg.destId;
}

export function countNullsInPayload(msg) {
    let count = 0;
    for (let i = 0; i < msg.payloadCount; i++) {
        if (msg.payload[i] === 0x00) count++;
    }
    return count;
}

// =============================================================================
// Event assignment lookups
// =============================================================================

/**
 * Searches the node's producer list for a matching event ID.
 * Returns the index if found, or -1 if not found. (C returns via out-param.)
 */
export function findProducerEventIndex(node, eventId) {
    const list = node.producers.list;
    for (let i = 0; i < node.producers.count; i++) {
        if (list[i].event === eventId) return i;
    }
    return -1;
}

export function findConsumerEventIndex(node, eventId) {
    const list = node.consumers.list;
    for (let i = 0; i < node.consumers.count; i++) {
        if (list[i].event === eventId) return i;
    }
    return -1;
}

// =============================================================================
// Config memory buffer (Uint8Array) — big-endian insert/extract
// =============================================================================

export function extractNodeIdFromConfigMemBuffer(buffer, index) {
    return (
        (BigInt(buffer[index])     << 40n) |
        (BigInt(buffer[index + 1]) << 32n) |
        (BigInt(buffer[index + 2]) << 24n) |
        (BigInt(buffer[index + 3]) << 16n) |
        (BigInt(buffer[index + 4]) << 8n)  |
         BigInt(buffer[index + 5])
    );
}

export function extractWordFromConfigMemBuffer(buffer, index) {
    return ((buffer[index] << 8) | buffer[index + 1]) & 0xFFFF;
}

export function copyNodeIdToConfigMemBuffer(buffer, nodeId, index) {
    let v = BigInt.asUintN(48, nodeId);
    for (let i = 5; i >= 0; i--) {
        buffer[index + i] = Number(v & 0xFFn);
        v >>= 8n;
    }
}

export function copyEventIdToConfigMemBuffer(buffer, eventId, index) {
    let v = BigInt.asUintN(64, eventId);
    for (let i = 7; i >= 0; i--) {
        buffer[index + i] = Number(v & 0xFFn);
        v >>= 8n;
    }
}

export function extractEventIdFromConfigMemBuffer(buffer, index) {
    return (
        (BigInt(buffer[index])     << 56n) |
        (BigInt(buffer[index + 1]) << 48n) |
        (BigInt(buffer[index + 2]) << 40n) |
        (BigInt(buffer[index + 3]) << 32n) |
        (BigInt(buffer[index + 4]) << 24n) |
        (BigInt(buffer[index + 5]) << 16n) |
        (BigInt(buffer[index + 6]) << 8n)  |
         BigInt(buffer[index + 7])
    );
}

// =============================================================================
// Node / memory helpers
// =============================================================================

export function calculateMemoryOffsetIntoNodeSpace(node) {
    const cfg = node.parameters.addressSpaceConfigMemory;
    let offsetPerNode = cfg.highestAddress;
    if (cfg.lowAddressValid) {
        offsetPerNode = cfg.highestAddress - cfg.lowAddress;
    }
    return offsetPerNode * node.index;
}

// =============================================================================
// Event range utilities
// =============================================================================

/**
 * Returns true if the event ID falls within any of the node's consumer ranges.
 */
export function isEventIdInConsumerRanges(node, eventId) {
    for (let i = 0; i < node.consumers.rangeCount; i++) {
        const r = node.consumers.rangeList[i];
        const startEvent = r.startBase;
        const endEvent = r.startBase + BigInt(r.eventCount);
        if (eventId >= startEvent && eventId <= endEvent) return true;
    }
    return false;
}

export function isEventIdInProducerRanges(node, eventId) {
    for (let i = 0; i < node.producers.rangeCount; i++) {
        const r = node.producers.rangeList[i];
        const startEvent = r.startBase;
        const endEvent = r.startBase + BigInt(r.eventCount);
        if (eventId >= startEvent && eventId <= endEvent) return true;
    }
    return false;
}

/**
 * Produces a masked event ID for a Range Identified message covering `count`
 * consecutive events starting at `baseEventId`. Algorithm mirrors the C port:
 * compute bitsNeeded = ceil(log2(count)); mask = (1 << bitsNeeded) - 1;
 * return (base & ~mask) | mask.
 */
export function generateEventRangeId(baseEventId, count) {
    let bitsNeeded = 0n;
    let temp = BigInt(count) - 1n;
    while (temp > 0n) {
        bitsNeeded++;
        temp >>= 1n;
    }
    const mask = (1n << bitsNeeded) - 1n;
    return (baseEventId & ~mask) | mask;
}

// =============================================================================
// Config memory reply builders — mirror C's openlcb_utilities load_config_mem_*
// =============================================================================

/**
 * Build a config-memory write-OK reply datagram header. The caller provides
 * a statemachine-info-shaped object:
 *   sm = { node, incoming: { msg }, outgoing: { msg, valid } }
 * and a request descriptor:
 *   req = { encoding, address }
 */
export function loadConfigMemReplyWriteOkHeader(sm, req) {
    sm.outgoing.msg.payloadCount = 0;
    loadOpenlcbMessage(
        sm.outgoing.msg,
        sm.node.alias, sm.node.id,
        sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
        MTI_DATAGRAM
    );
    copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_CONFIGURATION, 0);
    copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[1] + CONFIG_MEM_REPLY_OK_OFFSET, 1);
    copyDwordToPayload(sm.outgoing.msg, req.address, 2);
    if (req.encoding === ADDRESS_SPACE_ENCODING.IN_BYTE_6) {
        copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[6], 6);
    }
    sm.outgoing.valid = false;
}

export function loadConfigMemReplyWriteFailHeader(sm, req, errorCode) {
    sm.outgoing.msg.payloadCount = 0;
    loadOpenlcbMessage(
        sm.outgoing.msg,
        sm.node.alias, sm.node.id,
        sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
        MTI_DATAGRAM
    );
    copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_CONFIGURATION, 0);
    copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[1] + CONFIG_MEM_REPLY_FAIL_OFFSET, 1);
    copyDwordToPayload(sm.outgoing.msg, req.address, 2);
    if (req.encoding === ADDRESS_SPACE_ENCODING.IN_BYTE_6) {
        copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[6], 6);
        copyWordToPayload(sm.outgoing.msg, errorCode, 7);
    } else {
        copyWordToPayload(sm.outgoing.msg, errorCode, 6);
    }
    sm.outgoing.valid = false;
}

/** Build a read-OK reply *header* — caller appends data bytes starting at req.dataStart. */
export function loadConfigMemReplyReadOkHeader(sm, req) {
    sm.outgoing.msg.payloadCount = 0;
    loadOpenlcbMessage(
        sm.outgoing.msg,
        sm.node.alias, sm.node.id,
        sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
        MTI_DATAGRAM
    );
    copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_CONFIGURATION, 0);
    copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[1] + CONFIG_MEM_REPLY_OK_OFFSET, 1);
    copyDwordToPayload(sm.outgoing.msg, req.address, 2);
    if (req.encoding === ADDRESS_SPACE_ENCODING.IN_BYTE_6) {
        copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[6], 6);
    }
    sm.outgoing.valid = false;
}

export function loadConfigMemReplyReadFailHeader(sm, req, errorCode) {
    sm.outgoing.msg.payloadCount = 0;
    loadOpenlcbMessage(
        sm.outgoing.msg,
        sm.node.alias, sm.node.id,
        sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
        MTI_DATAGRAM
    );
    copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_CONFIGURATION, 0);
    copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[1] + CONFIG_MEM_REPLY_FAIL_OFFSET, 1);
    copyDwordToPayload(sm.outgoing.msg, req.address, 2);
    if (req.encoding === ADDRESS_SPACE_ENCODING.IN_BYTE_6) {
        copyByteToPayload(sm.outgoing.msg, sm.incoming.msg.payload[6], 6);
    }
    copyWordToPayload(sm.outgoing.msg, errorCode, req.dataStart);
}

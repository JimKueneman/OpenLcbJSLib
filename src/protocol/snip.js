// Ported from OpenLcbCLib/src/openlcb/protocol_snip.[hc].
//
// Simple Node Information Protocol. Builds a SNIP reply (MTI 0x0A08) out of
// node parameters (mfg/model/HW/SW) and config-memory reads (user name /
// description). The reply has 8 fields with NULL separators — 6 NULLs total
// across the payload when the message is well-formed.

import {
    MTI_SIMPLE_NODE_INFO_REPLY,
    CONFIG_MEM_CONFIG_USER_NAME_OFFSET,
    CONFIG_MEM_CONFIG_USER_DESCRIPTION_OFFSET,
    LEN_SNIP_NAME_BUFFER,
    LEN_SNIP_MODEL_BUFFER,
    LEN_SNIP_HARDWARE_VERSION_BUFFER,
    LEN_SNIP_SOFTWARE_VERSION_BUFFER,
    LEN_SNIP_USER_NAME_BUFFER,
    LEN_SNIP_USER_DESCRIPTION_BUFFER,
    LEN_MESSAGE_BYTES_SNIP,
} from '../openlcb/defines.js';
import {
    loadOpenlcbMessage,
    countNullsInPayload,
} from '../openlcb/utilities.js';

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

/**
 * Copy a null-terminated string into the payload. Truncates to
 * min(string, maxStrLen - 1, byteCount - 1) and always appends 0x00.
 * Returns the offset just past the written NULL byte.
 *
 * The `byteCount` argument mirrors the C `requested_bytes` parameter —
 * callers pass a field-size budget so the serializer won't overflow.
 */
function processString(outgoingMsg, offset, str, maxStrLen, byteCount) {
    const strLen = str.length;
    const maxFitting = Math.min(strLen, maxStrLen - 1);
    const copyLen = (byteCount > 0 && maxFitting > byteCount - 1) ? byteCount - 1 : maxFitting;

    for (let i = 0; i < copyLen; i++) {
        outgoingMsg.payload[offset + i] = str.charCodeAt(i) & 0xFF;
    }
    outgoingMsg.payload[offset + copyLen] = 0x00;
    outgoingMsg.payloadCount += copyLen + 1;
    return offset + copyLen + 1;
}

function processVersion(outgoingMsg, offset, version) {
    outgoingMsg.payload[offset] = version & 0xFF;
    outgoingMsg.payloadCount++;
    return offset + 1;
}

export class ProtocolSnip {
    /**
     * @param {Object} [deps]
     * @param {(node, address, count, buffer) => void} [deps.configMemoryRead]
     *        Callback to read `count` bytes from a node's Configuration Memory
     *        space (0xFD) into the provided Uint8Array.
     */
    constructor(deps = {}) {
        this._configMemoryRead = deps.configMemoryRead ?? null;
    }

    // -------------------------------------------------------------------------
    // Field loaders — each returns the offset just past the field written
    // -------------------------------------------------------------------------

    loadManufacturerVersionId(node, outgoingMsg, offset, requestedBytes) {
        if (requestedBytes > 0) {
            return processVersion(outgoingMsg, offset, node.parameters.snip.mfgVersion);
        }
        return offset;
    }

    loadName(node, outgoingMsg, offset, requestedBytes) {
        return processString(outgoingMsg, offset, node.parameters.snip.name, LEN_SNIP_NAME_BUFFER, requestedBytes);
    }

    loadModel(node, outgoingMsg, offset, requestedBytes) {
        return processString(outgoingMsg, offset, node.parameters.snip.model, LEN_SNIP_MODEL_BUFFER, requestedBytes);
    }

    loadHardwareVersion(node, outgoingMsg, offset, requestedBytes) {
        return processString(outgoingMsg, offset, node.parameters.snip.hardwareVersion, LEN_SNIP_HARDWARE_VERSION_BUFFER, requestedBytes);
    }

    loadSoftwareVersion(node, outgoingMsg, offset, requestedBytes) {
        return processString(outgoingMsg, offset, node.parameters.snip.softwareVersion, LEN_SNIP_SOFTWARE_VERSION_BUFFER, requestedBytes);
    }

    loadUserVersionId(node, outgoingMsg, offset, requestedBytes) {
        if (requestedBytes > 0) {
            return processVersion(outgoingMsg, offset, node.parameters.snip.userVersion);
        }
        return offset;
    }

    loadUserName(node, outgoingMsg, offset, requestedBytes) {
        return this._loadConfigMemString(
            node, outgoingMsg, offset, requestedBytes,
            CONFIG_MEM_CONFIG_USER_NAME_OFFSET, LEN_SNIP_USER_NAME_BUFFER
        );
    }

    loadUserDescription(node, outgoingMsg, offset, requestedBytes) {
        return this._loadConfigMemString(
            node, outgoingMsg, offset, requestedBytes,
            CONFIG_MEM_CONFIG_USER_DESCRIPTION_OFFSET, LEN_SNIP_USER_DESCRIPTION_BUFFER
        );
    }

    _loadConfigMemString(node, outgoingMsg, offset, requestedBytes, baseOffset, fieldMaxLen) {
        let address = baseOffset;
        const cfg = node.parameters.addressSpaceConfigMemory;
        if (cfg && cfg.lowAddressValid) address += cfg.lowAddress;

        if (!this._configMemoryRead) {
            return processString(outgoingMsg, offset, '', fieldMaxLen, requestedBytes);
        }

        const buffer = new Uint8Array(requestedBytes);
        this._configMemoryRead(node, address, requestedBytes, buffer);

        // Buffer is assumed to be null-terminated or full; decode up to the NULL.
        let strLen = 0;
        while (strLen < buffer.length && buffer[strLen] !== 0x00) strLen++;
        let str = '';
        for (let i = 0; i < strLen; i++) str += String.fromCharCode(buffer[i]);

        return processString(outgoingMsg, offset, str, fieldMaxLen, requestedBytes);
    }

    // -------------------------------------------------------------------------
    // Public MTI handlers
    // -------------------------------------------------------------------------

    /** Build and return a SNIP reply. 8 fields appended in order. */
    handleSimpleNodeInfoRequest(sm) {
        let off = 0;
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_SIMPLE_NODE_INFO_REPLY
        );

        off = this.loadManufacturerVersionId(sm.node, sm.outgoing.msg, off, 1);
        off = this.loadName(sm.node, sm.outgoing.msg, off, LEN_SNIP_NAME_BUFFER - 1);
        off = this.loadModel(sm.node, sm.outgoing.msg, off, LEN_SNIP_MODEL_BUFFER - 1);
        off = this.loadHardwareVersion(sm.node, sm.outgoing.msg, off, LEN_SNIP_HARDWARE_VERSION_BUFFER - 1);
        off = this.loadSoftwareVersion(sm.node, sm.outgoing.msg, off, LEN_SNIP_SOFTWARE_VERSION_BUFFER - 1);
        off = this.loadUserVersionId(sm.node, sm.outgoing.msg, off, 1);
        off = this.loadUserName(sm.node, sm.outgoing.msg, off, LEN_SNIP_USER_NAME_BUFFER - 1);
        off = this.loadUserDescription(sm.node, sm.outgoing.msg, off, LEN_SNIP_USER_DESCRIPTION_BUFFER - 1);

        sm.outgoing.valid = true;
    }

    handleSimpleNodeInfoReply(sm) {
        sm.outgoing.valid = false;
    }

    /**
     * Validate a SNIP reply: correct MTI, size, and exactly 6 NULL separators.
     * @param {Object} snipReplyMsg
     * @returns {boolean}
     */
    static validateSnipReply(snipReplyMsg) {
        if (snipReplyMsg.payloadCount > LEN_MESSAGE_BYTES_SNIP) return false;
        if (snipReplyMsg.mti !== MTI_SIMPLE_NODE_INFO_REPLY) return false;
        return countNullsInPayload(snipReplyMsg) === 6;
    }
}

// Ported from OpenLcbCLib/src/openlcb/protocol_config_mem_write_handler.[hc].
//
// Two-phase config-memory write + write-under-mask. Same two-phase pattern
// as the read handler: first call validates + ACKs, second call (dispatcher
// re-enumerate) performs the write and queues the reply datagram.
//
// Write-under-mask payloads are (Mask, Data) byte pairs per MemoryConfigurationS
// §4.10. A read-modify-write merges them: new = (old & ~mask) | (data & mask).

import {
    CONFIG_MEM_WRITE_SPACE_IN_BYTE_6,
    CONFIG_MEM_WRITE_UNDER_MASK_SPACE_IN_BYTE_6,
    CONFIG_MEM_ACDI_USER_NAME_ADDRESS,
    CONFIG_MEM_ACDI_USER_DESCRIPTION_ADDRESS,
    CONFIG_MEM_CONFIG_USER_NAME_OFFSET,
    CONFIG_MEM_CONFIG_USER_DESCRIPTION_OFFSET,
    S_OK,
    ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN,
    ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN,
    ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS,
    ERROR_PERMANENT_CONFIG_MEM_ADDRESS_WRITE_TO_READ_ONLY,
    ERROR_PERMANENT_INVALID_ARGUMENTS,
    ERROR_TEMPORARY_TRANSFER_ERROR,
} from '../openlcb/defines.js';
import { ADDRESS_SPACE_ENCODING } from '../openlcb/types.js';
import {
    extractDwordFromPayload,
    loadConfigMemReplyWriteOkHeader,
    loadConfigMemReplyWriteFailHeader,
} from '../openlcb/utilities.js';

function extractWriteRequest(sm) {
    const msg = sm.incoming.msg;
    const inByte6 = msg.payload[1] === CONFIG_MEM_WRITE_SPACE_IN_BYTE_6;
    const dataStart = inByte6 ? 7 : 6;
    return {
        address:     extractDwordFromPayload(msg, 2),
        encoding:    inByte6 ? ADDRESS_SPACE_ENCODING.IN_BYTE_6 : ADDRESS_SPACE_ENCODING.IN_BYTE_1,
        bytes:       msg.payloadCount - dataStart,
        dataStart,
        writeBuffer: msg.payload.subarray(dataStart, dataStart + (msg.payloadCount - dataStart)),
        spaceInfo:   null,
        writeSpaceFunc: null,
    };
}

function extractWriteUnderMaskRequest(sm) {
    const msg = sm.incoming.msg;
    const inByte6 = msg.payload[1] === CONFIG_MEM_WRITE_UNDER_MASK_SPACE_IN_BYTE_6;
    const header = inByte6 ? 7 : 6;
    const totalDataMask = msg.payloadCount - header;
    return {
        address:       extractDwordFromPayload(msg, 2),
        encoding:      inByte6 ? ADDRESS_SPACE_ENCODING.IN_BYTE_6 : ADDRESS_SPACE_ENCODING.IN_BYTE_1,
        bytes:         Math.floor(totalDataMask / 2),
        dataStart:     header,
        // (Mask, Data) pairs live in the payload starting at `header`.
        writeBuffer:   msg.payload.subarray(header, header + totalDataMask),
        totalDataMask,
        spaceInfo:     null,
    };
}

function validateWrite(req) {
    if (!req.writeSpaceFunc) return ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN;
    if (!req.spaceInfo || !req.spaceInfo.present) return ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN;
    if (req.spaceInfo.readOnly) return ERROR_PERMANENT_CONFIG_MEM_ADDRESS_WRITE_TO_READ_ONLY;
    if (req.bytes === 0 || req.bytes > 64) return ERROR_PERMANENT_INVALID_ARGUMENTS;
    return S_OK;
}

function validateWriteUnderMask(req) {
    if (!req.spaceInfo || !req.spaceInfo.present) return ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN;
    if (req.spaceInfo.readOnly) return ERROR_PERMANENT_CONFIG_MEM_ADDRESS_WRITE_TO_READ_ONLY;
    if (req.bytes === 0 || req.bytes > 64) return ERROR_PERMANENT_INVALID_ARGUMENTS;
    if (req.totalDataMask % 2 !== 0) return ERROR_PERMANENT_INVALID_ARGUMENTS;
    return S_OK;
}

function clampOverrun(req) {
    if (req.address + req.bytes >= req.spaceInfo.highestAddress) {
        req.bytes = (req.spaceInfo.highestAddress - req.address) + 1;
        if (req.bytes < 0) req.bytes = 0;
    }
}

// =============================================================================

export class ProtocolConfigMemWrite {
    /**
     * @param {Object} deps
     * @param {(sm, seconds) => void} deps.loadDatagramReceivedOk       required
     * @param {(sm, errorCode) => void} deps.loadDatagramRejected       required
     * @param {(node, address, count, buffer) => number} [deps.configMemoryWrite]
     *        Writes `count` bytes from `buffer` to the node's storage. Returns written.
     * @param {(node, address, count, buffer) => number} [deps.configMemoryRead]
     *        Required for write-under-mask (read-modify-write).
     * @param {Object} [deps.writeRequestOverrides] optional per-space handler overrides
     * @param {(sm, req) => number} [deps.writeRequestFirmware]
     *        Firmware-upgrade space (0xEF). Callback signature differs — it
     *        invokes its completion via the returned promise / direct `sm.outgoing`
     *        manipulation; mirrors the C write_result callback.
     * @param {(sm, req) => number} [deps.delayedReplyTime]
     */
    constructor(deps = {}) {
        this._d = deps;
    }

    // -------------------------------------------------------------------------
    // Per-space entry points (plain write)
    // -------------------------------------------------------------------------

    writeSpaceConfigDescriptionInfo(sm) {
        this._writeSpace(sm,
            sm.node.parameters.addressSpaceConfigurationDefinitionInfo,
            this._d.writeRequestOverrides?.configDefinitionInfo ?? null);
    }

    writeSpaceAll(sm) {
        this._writeSpace(sm,
            sm.node.parameters.addressSpaceAll,
            this._d.writeRequestOverrides?.all ?? this._defaultWriteConfigMem.bind(this));
    }

    writeSpaceConfigMemory(sm) {
        this._writeSpace(sm,
            sm.node.parameters.addressSpaceConfigMemory,
            this._d.writeRequestOverrides?.configMem ?? this._defaultWriteConfigMem.bind(this));
    }

    writeSpaceAcdiManufacturer(sm) {
        this._writeSpace(sm,
            sm.node.parameters.addressSpaceAcdiManufacturer,
            this._d.writeRequestOverrides?.acdiManufacturer ?? null);
    }

    writeSpaceAcdiUser(sm) {
        this._writeSpace(sm,
            sm.node.parameters.addressSpaceAcdiUser,
            this._d.writeRequestOverrides?.acdiUser ?? this._defaultWriteAcdiUser.bind(this));
    }

    writeSpaceTrainFunctionDefinitionInfo(sm) {
        this._writeSpace(sm,
            sm.node.parameters.addressSpaceTrainFunctionDefinitionInfo,
            this._d.writeRequestOverrides?.trainFunctionDefinitionInfo ?? null);
    }

    writeSpaceTrainFunctionConfigMemory(sm) {
        this._writeSpace(sm,
            sm.node.parameters.addressSpaceTrainFunctionConfigMemory,
            this._d.writeRequestOverrides?.trainFunctionConfigMemory ?? this._defaultWriteConfigMem.bind(this));
    }

    writeSpaceFirmware(sm) {
        this._writeSpace(sm,
            sm.node.parameters.addressSpaceFirmware,
            this._d.writeRequestFirmware ?? null);
    }

    // -------------------------------------------------------------------------
    // Per-space entry points (write-under-mask)
    // -------------------------------------------------------------------------

    writeUnderMaskSpaceConfigDescriptionInfo(sm) { this._writeUnderMaskSpace(sm, sm.node.parameters.addressSpaceConfigurationDefinitionInfo); }
    writeUnderMaskSpaceAll(sm)                   { this._writeUnderMaskSpace(sm, sm.node.parameters.addressSpaceAll); }
    writeUnderMaskSpaceConfigMemory(sm)          { this._writeUnderMaskSpace(sm, sm.node.parameters.addressSpaceConfigMemory); }
    writeUnderMaskSpaceAcdiManufacturer(sm)      { this._writeUnderMaskSpace(sm, sm.node.parameters.addressSpaceAcdiManufacturer); }
    writeUnderMaskSpaceAcdiUser(sm)              { this._writeUnderMaskSpace(sm, sm.node.parameters.addressSpaceAcdiUser); }
    writeUnderMaskSpaceTrainFunctionDefinitionInfo(sm) { this._writeUnderMaskSpace(sm, sm.node.parameters.addressSpaceTrainFunctionDefinitionInfo); }
    writeUnderMaskSpaceTrainFunctionConfigMemory(sm)   { this._writeUnderMaskSpace(sm, sm.node.parameters.addressSpaceTrainFunctionConfigMemory); }
    writeUnderMaskSpaceFirmware(sm)              { this._writeUnderMaskSpace(sm, sm.node.parameters.addressSpaceFirmware); }

    // -------------------------------------------------------------------------
    // Shared two-phase drivers
    // -------------------------------------------------------------------------

    _writeSpace(sm, spaceInfo, writeFunc) {
        const req = extractWriteRequest(sm);
        req.spaceInfo = spaceInfo;
        req.writeSpaceFunc = writeFunc;

        if (!sm.node.state.openlcbDatagramAckSent) {
            const err = validateWrite(req);
            if (err !== S_OK) {
                this._d.loadDatagramRejected(sm, err);
                return;
            }
            const delay = this._d.delayedReplyTime ? this._d.delayedReplyTime(sm, req) : 0;
            this._d.loadDatagramReceivedOk(sm, delay);
            sm.node.state.openlcbDatagramAckSent = true;
            sm.incoming.enumerate = true;
            return;
        }

        if (req.address > spaceInfo.highestAddress) {
            loadConfigMemReplyWriteFailHeader(sm, req, ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS);
            sm.outgoing.valid = true;
        } else {
            clampOverrun(req);
            writeFunc(sm, req);
        }
        sm.node.state.openlcbDatagramAckSent = false;
        sm.incoming.enumerate = false;
    }

    _writeUnderMaskSpace(sm, spaceInfo) {
        const req = extractWriteUnderMaskRequest(sm);
        req.spaceInfo = spaceInfo;

        if (!sm.node.state.openlcbDatagramAckSent) {
            const err = validateWriteUnderMask(req);
            if (err !== S_OK) {
                this._d.loadDatagramRejected(sm, err);
                return;
            }
            const delay = this._d.delayedReplyTime ? this._d.delayedReplyTime(sm, req) : 0;
            this._d.loadDatagramReceivedOk(sm, delay);
            sm.node.state.openlcbDatagramAckSent = true;
            sm.incoming.enumerate = true;
            return;
        }

        if (req.address > spaceInfo.highestAddress) {
            loadConfigMemReplyWriteFailHeader(sm, req, ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS);
            sm.outgoing.valid = true;
        } else {
            clampOverrun(req);
            loadConfigMemReplyWriteOkHeader(sm, req);
            this._writeDataUnderMask(sm, req);
        }
        sm.node.state.openlcbDatagramAckSent = false;
        sm.incoming.enumerate = false;
    }

    // -------------------------------------------------------------------------
    // Default writers
    // -------------------------------------------------------------------------

    _defaultWriteConfigMem(sm, req) {
        loadConfigMemReplyWriteOkHeader(sm, req);
        this._writeData(sm, req, req.address, req.writeBuffer.subarray(0, req.bytes));
    }

    _defaultWriteAcdiUser(sm, req) {
        // Remap ACDI virtual addresses to the underlying config-memory space.
        // Reply echoes the original ACDI address (do not touch req.address).
        let configAddress;
        switch (req.address) {
            case CONFIG_MEM_ACDI_USER_NAME_ADDRESS:
                configAddress = CONFIG_MEM_CONFIG_USER_NAME_OFFSET;
                break;
            case CONFIG_MEM_ACDI_USER_DESCRIPTION_ADDRESS:
                configAddress = CONFIG_MEM_CONFIG_USER_DESCRIPTION_OFFSET;
                break;
            default:
                loadConfigMemReplyWriteFailHeader(sm, req, ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS);
                sm.outgoing.valid = true;
                return;
        }
        const cfg = sm.node.parameters.addressSpaceConfigMemory;
        if (cfg && cfg.lowAddressValid) configAddress += cfg.lowAddress;

        const writeCount = this._d.configMemoryWrite
            ? this._d.configMemoryWrite(sm.node, configAddress, req.bytes, req.writeBuffer.subarray(0, req.bytes))
            : 0;

        if (!this._d.configMemoryWrite || writeCount < req.bytes) {
            loadConfigMemReplyWriteFailHeader(sm, req,
                this._d.configMemoryWrite ? ERROR_TEMPORARY_TRANSFER_ERROR : ERROR_PERMANENT_INVALID_ARGUMENTS);
        } else {
            loadConfigMemReplyWriteOkHeader(sm, req);
        }
        sm.outgoing.valid = true;
    }

    _writeData(sm, req, address, buffer) {
        if (!this._d.configMemoryWrite) {
            loadConfigMemReplyWriteFailHeader(sm, req, ERROR_PERMANENT_INVALID_ARGUMENTS);
            sm.outgoing.valid = true;
            return 0;
        }
        const writeCount = this._d.configMemoryWrite(sm.node, address, buffer.length, buffer);
        if (writeCount < buffer.length) {
            loadConfigMemReplyWriteFailHeader(sm, req, ERROR_TEMPORARY_TRANSFER_ERROR);
        }
        sm.outgoing.valid = true;
        return writeCount;
    }

    _writeDataUnderMask(sm, req) {
        if (!this._d.configMemoryRead) {
            loadConfigMemReplyWriteFailHeader(sm, req, ERROR_PERMANENT_INVALID_ARGUMENTS);
            sm.outgoing.valid = true;
            return 0;
        }

        const current = new Uint8Array(req.bytes);
        const readCount = this._d.configMemoryRead(sm.node, req.address, req.bytes, current);
        if (readCount < req.bytes) {
            loadConfigMemReplyWriteFailHeader(sm, req, ERROR_TEMPORARY_TRANSFER_ERROR);
            sm.outgoing.valid = true;
            return 0;
        }

        // Merge (Mask, Data) pairs: new = (old & ~mask) | (data & mask).
        const pairs = req.writeBuffer;
        for (let i = 0; i < req.bytes; i++) {
            const mask = pairs[i * 2];
            const data = pairs[i * 2 + 1];
            current[i] = (current[i] & ~mask) | (data & mask);
        }

        if (!this._d.configMemoryWrite) {
            loadConfigMemReplyWriteFailHeader(sm, req, ERROR_PERMANENT_INVALID_ARGUMENTS);
            sm.outgoing.valid = true;
            return 0;
        }
        const writeCount = this._d.configMemoryWrite(sm.node, req.address, req.bytes, current);
        if (writeCount < req.bytes) {
            loadConfigMemReplyWriteFailHeader(sm, req, ERROR_TEMPORARY_TRANSFER_ERROR);
        }
        sm.outgoing.valid = true;
        return writeCount;
    }
}

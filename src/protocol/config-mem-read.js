// Ported from OpenLcbCLib/src/openlcb/protocol_config_mem_read_handler.[hc].
//
// Two-phase config-memory read:
//   1. First call validates the request; on success emits Datagram Received OK
//      (with reply-pending bit) and sets `incoming.enumerate = true`.
//   2. Second call (the dispatcher's re-enumerate) builds the read-reply
//      datagram with the payload data.
//
// The JS port collapses the 8 near-identical per-space entry points (C has
// one for each of CDI/All/Config/ACDI-Mfg/ACDI-User/Train-FDI/Train-Fn-Config)
// into a single `readSpace(sm, spaceByte)` method plus a per-space reader
// table keyed by the space byte.

import {
    CONFIG_MEM_READ_SPACE_IN_BYTE_6,
    CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO,
    CONFIG_MEM_SPACE_ALL,
    CONFIG_MEM_SPACE_CONFIGURATION_MEMORY,
    CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS,
    CONFIG_MEM_SPACE_ACDI_USER_ACCESS,
    CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO,
    CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY,
    CONFIG_MEM_ACDI_MANUFACTURER_VERSION_ADDRESS,
    CONFIG_MEM_ACDI_MANUFACTURER_ADDRESS,
    CONFIG_MEM_ACDI_MODEL_ADDRESS,
    CONFIG_MEM_ACDI_HARDWARE_VERSION_ADDRESS,
    CONFIG_MEM_ACDI_SOFTWARE_VERSION_ADDRESS,
    CONFIG_MEM_ACDI_USER_VERSION_ADDRESS,
    CONFIG_MEM_ACDI_USER_NAME_ADDRESS,
    CONFIG_MEM_ACDI_USER_DESCRIPTION_ADDRESS,
    S_OK,
    ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN,
    ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN,
    ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS,
    ERROR_PERMANENT_INVALID_ARGUMENTS,
    ERROR_TEMPORARY_TRANSFER_ERROR,
} from '../openlcb/defines.js';
import { ADDRESS_SPACE_ENCODING } from '../openlcb/types.js';
import {
    extractDwordFromPayload,
    copyByteToPayload,
    copyByteArrayToPayload,
    loadConfigMemReplyReadOkHeader,
    loadConfigMemReplyReadFailHeader,
} from '../openlcb/utilities.js';

/** Parse address/byte-count/encoding out of an incoming read datagram. */
function extractReadRequest(sm) {
    const msg = sm.incoming.msg;
    const inByte6 = msg.payload[1] === CONFIG_MEM_READ_SPACE_IN_BYTE_6;
    return {
        address:   extractDwordFromPayload(msg, 2),
        encoding:  inByte6 ? ADDRESS_SPACE_ENCODING.IN_BYTE_6 : ADDRESS_SPACE_ENCODING.IN_BYTE_1,
        bytes:     inByte6 ? msg.payload[7] : msg.payload[6],
        dataStart: inByte6 ? 7 : 6,
        spaceInfo: null,
        readSpaceFunc: null,
    };
}

function validate(req) {
    if (!req.readSpaceFunc) return ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN;
    if (!req.spaceInfo || !req.spaceInfo.present) return ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN;
    if (req.bytes === 0 || req.bytes > 64) return ERROR_PERMANENT_INVALID_ARGUMENTS;
    return S_OK;
}

function clampOverrun(req) {
    if (req.address + req.bytes >= req.spaceInfo.highestAddress) {
        req.bytes = (req.spaceInfo.highestAddress - req.address) + 1;
        if (req.bytes < 0) req.bytes = 0;
    }
}

// =============================================================================

export class ProtocolConfigMemRead {
    /**
     * @param {Object} deps
     * @param {(sm, seconds) => void} deps.loadDatagramReceivedOk       required
     * @param {(sm, errorCode) => void} deps.loadDatagramRejected       required
     * @param {(node, address, count, buffer) => number} [deps.configMemoryRead]
     *        Reads `count` bytes into `buffer` (Uint8Array-like). Returns bytes read.
     * @param {Object} [deps.snip]
     *        SNIP field loaders (functions) for 0xFC/0xFB dispatch.
     *        Keys: loadManufacturerVersionId, loadName, loadModel, loadHardwareVersion,
     *              loadSoftwareVersion, loadUserVersionId, loadUserName, loadUserDescription.
     *        Each has signature (node, msg, offset, byteCount) => offset.
     * @param {(sm, req) => void} [deps.readRequestConfigDefinitionInfo] custom CDI reader
     * @param {(sm, req) => void} [deps.readRequestAll]
     * @param {(sm, req) => void} [deps.readRequestConfigMem]
     * @param {(sm, req) => void} [deps.readRequestAcdiManufacturer]
     * @param {(sm, req) => void} [deps.readRequestAcdiUser]
     * @param {(sm, req) => void} [deps.readRequestTrainFunctionConfigDefinitionInfo]
     * @param {(sm, req) => void} [deps.readRequestTrainFunctionConfigMemory]
     * @param {(sm, req) => number} [deps.delayedReplyTime]
     * @param {(node) => Object|null} [deps.getTrainState]
     */
    constructor(deps = {}) {
        this._d = deps;
    }

    // -------------------------------------------------------------------------
    // Per-space entry points
    // -------------------------------------------------------------------------

    readSpaceConfigDescriptionInfo(sm) {
        this._readSpace(sm,
            sm.node.parameters.addressSpaceConfigurationDefinitionInfo,
            this._d.readRequestConfigDefinitionInfo ?? this._defaultReadCdi.bind(this));
    }

    readSpaceAll(sm) {
        this._readSpace(sm,
            sm.node.parameters.addressSpaceAll,
            this._d.readRequestAll ?? this._defaultReadAll.bind(this));
    }

    readSpaceConfigMemory(sm) {
        this._readSpace(sm,
            sm.node.parameters.addressSpaceConfigMemory,
            this._d.readRequestConfigMem ?? this._defaultReadConfigMem.bind(this));
    }

    readSpaceAcdiManufacturer(sm) {
        this._readSpace(sm,
            sm.node.parameters.addressSpaceAcdiManufacturer,
            this._d.readRequestAcdiManufacturer ?? this._defaultReadAcdiManufacturer.bind(this));
    }

    readSpaceAcdiUser(sm) {
        this._readSpace(sm,
            sm.node.parameters.addressSpaceAcdiUser,
            this._d.readRequestAcdiUser ?? this._defaultReadAcdiUser.bind(this));
    }

    readSpaceTrainFunctionDefinitionInfo(sm) {
        this._readSpace(sm,
            sm.node.parameters.addressSpaceTrainFunctionDefinitionInfo,
            this._d.readRequestTrainFunctionConfigDefinitionInfo ?? this._defaultReadTrainFdi.bind(this));
    }

    readSpaceTrainFunctionConfigMemory(sm) {
        this._readSpace(sm,
            sm.node.parameters.addressSpaceTrainFunctionConfigMemory,
            this._d.readRequestTrainFunctionConfigMemory ?? this._defaultReadTrainFnCfg.bind(this));
    }

    // -------------------------------------------------------------------------
    // Shared two-phase driver
    // -------------------------------------------------------------------------

    _readSpace(sm, spaceInfo, readFunc) {
        const req = extractReadRequest(sm);
        req.spaceInfo = spaceInfo;
        req.readSpaceFunc = readFunc;

        if (!sm.node.state.openlcbDatagramAckSent) {
            const err = validate(req);
            if (err !== S_OK) {
                this._d.loadDatagramRejected(sm, err);
                return;
            }
            const delay = this._d.delayedReplyTime
                ? this._d.delayedReplyTime(sm, req)
                : 0;
            this._d.loadDatagramReceivedOk(sm, delay);
            sm.node.state.openlcbDatagramAckSent = true;
            sm.incoming.enumerate = true; // re-enter for phase 2
            return;
        }

        // Phase 2: build the reply datagram.
        if (req.address > spaceInfo.highestAddress) {
            loadConfigMemReplyReadFailHeader(sm, req, ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS);
            sm.outgoing.valid = true;
        } else {
            clampOverrun(req);
            readFunc(sm, req);
        }
        sm.node.state.openlcbDatagramAckSent = false;
        sm.incoming.enumerate = false;
    }

    // -------------------------------------------------------------------------
    // Default per-space readers
    // -------------------------------------------------------------------------

    _defaultReadCdi(sm, req) {
        const cdi = sm.node.parameters.cdi;
        if (!cdi) {
            loadConfigMemReplyReadFailHeader(sm, req, ERROR_PERMANENT_INVALID_ARGUMENTS);
            sm.outgoing.valid = true;
            return;
        }
        loadConfigMemReplyReadOkHeader(sm, req);
        copyByteArrayToPayload(sm.outgoing.msg, cdi.subarray(req.address, req.address + req.bytes), req.dataStart, req.bytes);
        sm.outgoing.valid = true;
    }

    _defaultReadAll(sm, req) {
        // Space 0xFE = virtual concat of other spaces. Per the plan we defer
        // this to the application via config_memory_read with space=0xFE.
        this._defaultReadConfigMem(sm, req);
    }

    _defaultReadConfigMem(sm, req) {
        if (!this._d.configMemoryRead) {
            loadConfigMemReplyReadFailHeader(sm, req, ERROR_PERMANENT_INVALID_ARGUMENTS);
            sm.outgoing.valid = true;
            return;
        }

        loadConfigMemReplyReadOkHeader(sm, req);
        const buffer = sm.outgoing.msg.payload.subarray(req.dataStart, req.dataStart + req.bytes);
        const readCount = this._d.configMemoryRead(sm.node, req.address, req.bytes, buffer);
        sm.outgoing.msg.payloadCount += readCount;

        if (readCount < req.bytes) {
            loadConfigMemReplyReadFailHeader(sm, req, ERROR_TEMPORARY_TRANSFER_ERROR);
        }
        sm.outgoing.valid = true;
    }

    _defaultReadTrainFdi(sm, req) {
        const fdi = sm.node.parameters.fdi;
        if (!fdi) {
            loadConfigMemReplyReadFailHeader(sm, req, ERROR_PERMANENT_INVALID_ARGUMENTS);
            sm.outgoing.valid = true;
            return;
        }
        loadConfigMemReplyReadOkHeader(sm, req);
        copyByteArrayToPayload(sm.outgoing.msg, fdi.subarray(req.address, req.address + req.bytes), req.dataStart, req.bytes);
        sm.outgoing.valid = true;
    }

    _defaultReadTrainFnCfg(sm, req) {
        loadConfigMemReplyReadOkHeader(sm, req);
        const state = this._d.getTrainState ? this._d.getTrainState(sm.node) : null;
        if (state && state.functions) {
            for (let i = 0; i < req.bytes; i++) {
                const fnIndex = Math.floor((req.address + i) / 2);
                const byteSel = (req.address + i) % 2;
                let val = 0;
                if (fnIndex < state.functions.length) {
                    val = byteSel === 0
                        ? (state.functions[fnIndex] >>> 8) & 0xFF
                        : state.functions[fnIndex] & 0xFF;
                }
                copyByteToPayload(sm.outgoing.msg, val, req.dataStart + i);
            }
        }
        sm.outgoing.valid = true;
    }

    _defaultReadAcdiManufacturer(sm, req) {
        loadConfigMemReplyReadOkHeader(sm, req);
        const snip = this._d.snip ?? {};
        const loader = this._acdiMfgLoader(req.address, snip);
        if (!loader) {
            loadConfigMemReplyReadFailHeader(sm, req,
                req.address <= CONFIG_MEM_ACDI_SOFTWARE_VERSION_ADDRESS
                    ? ERROR_PERMANENT_INVALID_ARGUMENTS
                    : ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN);
        } else {
            loader(sm.node, sm.outgoing.msg, req.dataStart, req.bytes);
        }
        sm.outgoing.valid = true;
    }

    _acdiMfgLoader(address, snip) {
        switch (address) {
            case CONFIG_MEM_ACDI_MANUFACTURER_VERSION_ADDRESS: return snip.loadManufacturerVersionId;
            case CONFIG_MEM_ACDI_MANUFACTURER_ADDRESS:         return snip.loadName;
            case CONFIG_MEM_ACDI_MODEL_ADDRESS:                return snip.loadModel;
            case CONFIG_MEM_ACDI_HARDWARE_VERSION_ADDRESS:     return snip.loadHardwareVersion;
            case CONFIG_MEM_ACDI_SOFTWARE_VERSION_ADDRESS:     return snip.loadSoftwareVersion;
            default: return null;
        }
    }

    _defaultReadAcdiUser(sm, req) {
        loadConfigMemReplyReadOkHeader(sm, req);
        const snip = this._d.snip ?? {};
        const loader = this._acdiUserLoader(req.address, snip);
        if (!loader) {
            loadConfigMemReplyReadFailHeader(sm, req,
                req.address <= CONFIG_MEM_ACDI_USER_DESCRIPTION_ADDRESS
                    ? ERROR_PERMANENT_INVALID_ARGUMENTS
                    : ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN);
        } else {
            loader(sm.node, sm.outgoing.msg, req.dataStart, req.bytes);
        }
        sm.outgoing.valid = true;
    }

    _acdiUserLoader(address, snip) {
        switch (address) {
            case CONFIG_MEM_ACDI_USER_VERSION_ADDRESS:     return snip.loadUserVersionId;
            case CONFIG_MEM_ACDI_USER_NAME_ADDRESS:        return snip.loadUserName;
            case CONFIG_MEM_ACDI_USER_DESCRIPTION_ADDRESS: return snip.loadUserDescription;
            default: return null;
        }
    }
}

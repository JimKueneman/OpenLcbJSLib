// Ported (skeleton) from OpenLcbCLib/src/openlcb/protocol_config_mem_stream_handler.[hc].
//
// Layer-2 bridge between Memory Configuration datagram commands (Read Stream
// / Write Stream) and Layer-1 Stream Transport. Each operation has a phase
// enum that the run loop drives forward: pumping data in the read direction,
// or waiting for incoming data in the write direction.
//
// The JS port exposes the per-space read/write callbacks via `deps` and
// delegates the actual stream initiate/data/complete messages to the
// `ProtocolStreamHandler` instance passed in.

import {
    MTI_DATAGRAM,
    CONFIG_MEM_CONFIGURATION,
    CONFIG_MEM_READ_STREAM_SPACE_IN_BYTE_6,
    CONFIG_MEM_WRITE_STREAM_SPACE_IN_BYTE_6,
    CONFIG_MEM_REPLY_OK_OFFSET,
    CONFIG_MEM_REPLY_FAIL_OFFSET,
    STREAM_ID_RESERVED,
    S_OK,
    ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN,
    ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS,
    ERROR_PERMANENT_CONFIG_MEM_ADDRESS_WRITE_TO_READ_ONLY,
    ERROR_PERMANENT_INVALID_ARGUMENTS,
    ERROR_TEMPORARY_TRANSFER_ERROR,
    CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO,
    CONFIG_MEM_SPACE_ALL,
    CONFIG_MEM_SPACE_CONFIGURATION_MEMORY,
    CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS,
    CONFIG_MEM_SPACE_ACDI_USER_ACCESS,
    CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO,
    CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY,
    CONFIG_MEM_SPACE_FIRMWARE,
    LEN_MESSAGE_BYTES_STREAM,
} from '../openlcb/defines.js';
import { ADDRESS_SPACE_ENCODING } from '../openlcb/types.js';
import {
    loadOpenlcbMessage,
    copyByteToPayload,
    copyDwordToPayload,
    copyWordToPayload,
    extractDwordFromPayload,
    extractWordFromPayload,
} from '../openlcb/utilities.js';

export const CONFIG_MEM_STREAM_PHASE = Object.freeze({
    IDLE: 0,
    ALLOCATED: 1,
    WAIT_INITIATE_REPLY: 2,
    SEND_REPLY_DATAGRAM: 3,
    PUMPING: 4,
    SEND_COMPLETE: 5,
    WRITE_WAIT_STREAM_INITIATE: 6,
    WRITE_RECEIVING: 7,
    WRITE_SEND_REPLY: 8,
});

function decodeSpace(spaceByte, params) {
    switch (spaceByte) {
        case CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO:      return params.addressSpaceConfigurationDefinitionInfo;
        case CONFIG_MEM_SPACE_ALL:                                return params.addressSpaceAll;
        case CONFIG_MEM_SPACE_CONFIGURATION_MEMORY:               return params.addressSpaceConfigMemory;
        case CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS:           return params.addressSpaceAcdiManufacturer;
        case CONFIG_MEM_SPACE_ACDI_USER_ACCESS:                   return params.addressSpaceAcdiUser;
        case CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO:     return params.addressSpaceTrainFunctionDefinitionInfo;
        case CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY: return params.addressSpaceTrainFunctionConfigMemory;
        case CONFIG_MEM_SPACE_FIRMWARE:                            return params.addressSpaceFirmware;
        default:                                                   return null;
    }
}

export class ProtocolConfigMemStream {
    /**
     * @param {Object} deps
     * @param {ProtocolStreamHandler} deps.streamHandler required
     * @param {(sm, seconds) => void} deps.loadDatagramReceivedOk required
     * @param {(sm, errorCode) => void} deps.loadDatagramRejected required
     * @param {Object} [deps.readCallbacks]  per-space reads keyed by space-name
     *                                       (e.g. configurationMemory, firmwareUpgrade)
     * @param {Object} [deps.writeCallbacks] per-space writes keyed by space-name
     * @param {number} [deps.maxConcurrentStreams=2]
     */
    constructor(deps) {
        this._d = deps;
        this._table = new Array(deps.maxConcurrentStreams ?? 2).fill(null).map(() => ({
            phase: CONFIG_MEM_STREAM_PHASE.IDLE,
            stream: null,
            node: null,
            spaceInfo: null,
            address: 0,
            remainingBytes: 0,
            totalBytes: 0,
            replyEncoding: ADDRESS_SPACE_ENCODING.IN_BYTE_6,
            replyOrigCmd: 0,
            replySpaceByte: 0,
            isWrite: false,
            readFunc: null,
            writeFunc: null,
        }));
    }

    _allocContext() {
        for (const c of this._table) {
            if (c.phase === CONFIG_MEM_STREAM_PHASE.IDLE) return c;
        }
        return null;
    }

    _freeContext(ctx) {
        ctx.phase = CONFIG_MEM_STREAM_PHASE.IDLE;
        ctx.stream = null;
        ctx.node = null;
        ctx.spaceInfo = null;
        ctx.address = 0;
        ctx.remainingBytes = 0;
        ctx.totalBytes = 0;
        ctx.readFunc = null;
        ctx.writeFunc = null;
    }

    // -------------------------------------------------------------------------
    // Incoming datagram entry points (wired into the datagram dispatcher)
    // -------------------------------------------------------------------------

    readStreamSpaceConfigDescriptionInfo(sm) { this._startRead(sm, 'configDescriptionInfo'); }
    readStreamSpaceAll(sm)                   { this._startRead(sm, 'all'); }
    readStreamSpaceConfigMemory(sm)          { this._startRead(sm, 'configurationMemory'); }
    readStreamSpaceAcdiManufacturer(sm)      { this._startRead(sm, 'acdiManufacturer'); }
    readStreamSpaceAcdiUser(sm)              { this._startRead(sm, 'acdiUser'); }
    readStreamSpaceTrainFunctionDefinitionInfo(sm) { this._startRead(sm, 'trainFunctionDefinitionInfo'); }
    readStreamSpaceTrainFunctionConfigMemory(sm)   { this._startRead(sm, 'trainFunctionConfigMemory'); }

    writeStreamSpaceConfigMemory(sm)              { this._startWrite(sm, 'configurationMemory'); }
    writeStreamSpaceAll(sm)                       { this._startWrite(sm, 'all'); }
    writeStreamSpaceConfigDescriptionInfo(sm)     { this._startWrite(sm, 'configDescriptionInfo'); }
    writeStreamSpaceAcdiManufacturer(sm)          { this._startWrite(sm, 'acdiManufacturer'); }
    writeStreamSpaceAcdiUser(sm)                  { this._startWrite(sm, 'acdiUser'); }
    writeStreamSpaceTrainFunctionDefinitionInfo(sm) { this._startWrite(sm, 'trainFunctionDefinitionInfo'); }
    writeStreamSpaceTrainFunctionConfigMemory(sm)  { this._startWrite(sm, 'trainFunctionConfigMemory'); }
    writeStreamSpaceFirmware(sm)                   { this._startWrite(sm, 'firmwareUpgrade'); }

    // -------------------------------------------------------------------------
    // Read startup (server side: this node is the source; requester is dest)
    // -------------------------------------------------------------------------

    _startRead(sm, spaceKey) {
        // Two-phase per MemCfg §4.6 and the C reference
        // (protocol_config_mem_stream_handler.c `_handle_read_stream`):
        //   Phase 1 (first dispatch): validate, emit Datagram Received OK,
        //     stash ctx, set enumerate/openlcbDatagramAckSent so the main
        //     state machine re-invokes this handler with the same incoming.
        //   Phase 2 (re-entry): find the stashed ctx and initiate the
        //     outbound stream. This avoids clobbering sm.outgoing.msg with
        //     two back-to-back sends in the same dispatch.
        const node = sm.node;
        if (!node.state.openlcbDatagramAckSent) {
            // --- Phase 1 ---
            const msg = sm.incoming.msg;
            const inByte6 = msg.payload[1] === CONFIG_MEM_READ_STREAM_SPACE_IN_BYTE_6;
            // Datagram layout (MemCfg §4.6):
            //   non-byte6: [0x20, cmd, addr(4), 0xFF, destStreamId, len(4)]
            //   byte6:     [0x20, 0x60, addr(4), space, 0xFF, destStreamId, len(4)]
            const lengthStart     = inByte6 ? 9 : 8;
            const destStreamIdOff = inByte6 ? 8 : 7;
            const address = extractDwordFromPayload(msg, 2);
            let bytes    = msg.payloadCount >= lengthStart + 4
                ? extractDwordFromPayload(msg, lengthStart) : 0;
            const suggestedDestStreamId = msg.payloadCount > destStreamIdOff
                ? msg.payload[destStreamIdOff] : STREAM_ID_RESERVED;

            const spaceInfo = this._spaceInfoByKey(spaceKey, node.parameters);
            if (!spaceInfo || !spaceInfo.present) {
                this._d.loadDatagramRejected(sm, ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN);
                return;
            }
            if (address > spaceInfo.highestAddress) {
                this._d.loadDatagramRejected(sm, ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS);
                return;
            }
            // Per MemCfg §4.6: length == 0 means "read to end of space".
            if (bytes === 0) {
                bytes = (spaceInfo.highestAddress - address + 1) >>> 0;
            }

            const ctx = this._allocContext();
            if (!ctx) {
                this._d.loadDatagramRejected(sm, ERROR_TEMPORARY_TRANSFER_ERROR);
                return;
            }

            ctx.phase = CONFIG_MEM_STREAM_PHASE.ALLOCATED;
            ctx.node = node;
            ctx.spaceInfo = spaceInfo;
            ctx.address = address;
            ctx.remainingBytes = bytes;
            ctx.totalBytes = bytes;
            ctx.readFunc = this._d.readCallbacks?.[spaceKey] ?? null;
            ctx.replyEncoding = inByte6 ? ADDRESS_SPACE_ENCODING.IN_BYTE_6 : ADDRESS_SPACE_ENCODING.IN_BYTE_1;
            ctx.replyOrigCmd = msg.payload[1];
            ctx.replySpaceByte = inByte6 ? msg.payload[6] : 0;
            ctx.remoteAlias = msg.sourceAlias;
            ctx.remoteNodeId = msg.sourceId;
            ctx.suggestedDestStreamId = suggestedDestStreamId;

            this._d.loadDatagramReceivedOk(sm, 0);
            node.state.openlcbDatagramAckSent = true;
            sm.incoming.enumerate = true;
            return;
        }

        // --- Phase 2: initiate the outbound stream to the requester ---
        const ctx = this._findAllocatedContext(node);
        node.state.openlcbDatagramAckSent = false;
        sm.incoming.enumerate = false;
        if (!ctx) return;

        const stream = this._d.streamHandler.initiateOutbound(
            sm,
            ctx.remoteAlias,
            ctx.remoteNodeId,
            512,                             // proposed buffer size
            ctx.suggestedDestStreamId ?? STREAM_ID_RESERVED,
            null,
        );
        if (!stream) {
            this._freeContext(ctx);
            return;
        }
        ctx.stream = stream;
        stream.context = ctx;
        ctx.phase = CONFIG_MEM_STREAM_PHASE.WAIT_INITIATE_REPLY;
    }

    _findAllocatedContext(node) {
        for (const c of this._table) {
            if (c.phase === CONFIG_MEM_STREAM_PHASE.ALLOCATED && c.node === node) return c;
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // Write startup (server side: this node is the destination; requester is source)
    // -------------------------------------------------------------------------

    _startWrite(sm, spaceKey) {
        const msg = sm.incoming.msg;
        const inByte6 = msg.payload[1] === CONFIG_MEM_WRITE_STREAM_SPACE_IN_BYTE_6;
        const dataStart = inByte6 ? 7 : 6;
        const address = extractDwordFromPayload(msg, 2);

        const spaceInfo = this._spaceInfoByKey(spaceKey, sm.node.parameters);
        if (!spaceInfo || !spaceInfo.present) {
            this._d.loadDatagramRejected(sm, ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN);
            return;
        }
        if (spaceInfo.readOnly && spaceKey !== 'firmwareUpgrade') {
            this._d.loadDatagramRejected(sm, ERROR_PERMANENT_CONFIG_MEM_ADDRESS_WRITE_TO_READ_ONLY);
            return;
        }
        if (address > spaceInfo.highestAddress) {
            this._d.loadDatagramRejected(sm, ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS);
            return;
        }

        const ctx = this._allocContext();
        if (!ctx) {
            this._d.loadDatagramRejected(sm, ERROR_TEMPORARY_TRANSFER_ERROR);
            return;
        }

        ctx.phase = CONFIG_MEM_STREAM_PHASE.WRITE_WAIT_STREAM_INITIATE;
        ctx.node = sm.node;
        ctx.spaceInfo = spaceInfo;
        ctx.address = address;
        ctx.isWrite = true;
        ctx.writeFunc = this._d.writeCallbacks?.[spaceKey] ?? null;
        ctx.replyEncoding = inByte6 ? ADDRESS_SPACE_ENCODING.IN_BYTE_6 : ADDRESS_SPACE_ENCODING.IN_BYTE_1;
        ctx.replyOrigCmd = msg.payload[1];
        ctx.replySpaceByte = inByte6 ? msg.payload[6] : 0;

        // Ack the datagram — the peer now sends a Stream Initiate Request.
        this._d.loadDatagramReceivedOk(sm, 0);
    }

    _spaceInfoByKey(key, params) {
        switch (key) {
            case 'configDescriptionInfo':       return params.addressSpaceConfigurationDefinitionInfo;
            case 'all':                         return params.addressSpaceAll;
            case 'configurationMemory':         return params.addressSpaceConfigMemory;
            case 'acdiManufacturer':            return params.addressSpaceAcdiManufacturer;
            case 'acdiUser':                    return params.addressSpaceAcdiUser;
            case 'trainFunctionDefinitionInfo': return params.addressSpaceTrainFunctionDefinitionInfo;
            case 'trainFunctionConfigMemory':   return params.addressSpaceTrainFunctionConfigMemory;
            case 'firmwareUpgrade':             return params.addressSpaceFirmware;
            default:                            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Stream-handler callback hooks — must be wired into the stream handler
    // via deps.onInitiateReply, deps.onDataReceived, deps.onDataProceed, deps.onComplete
    // -------------------------------------------------------------------------

    /**
     * Called from config.js's default `onStreamInitiateRequest` hook. If a
     * pending write context is waiting for the peer's Stream Initiate Request
     * (phase = WRITE_WAIT_STREAM_INITIATE) and the incoming request is from
     * the same remote node, bind the stream to the context, move to
     * WRITE_RECEIVING, and return the context so the caller can accept.
     * Returns null otherwise — caller should fall through to user callback.
     */
    claimWriteInitiate(sm, stream) {
        const remoteId = sm.incoming.msg.sourceId;
        for (const ctx of this._table) {
            if (ctx.phase !== CONFIG_MEM_STREAM_PHASE.WRITE_WAIT_STREAM_INITIATE) continue;
            if (ctx.node && ctx.node.id !== sm.node.id) continue;
            // Node-side context; match the first pending one for this remote.
            ctx.stream = stream;
            ctx.phase = CONFIG_MEM_STREAM_PHASE.WRITE_RECEIVING;
            void remoteId; // reserved for future multi-peer disambiguation
            return ctx;
        }
        return null;
    }

    /** Call from stream handler's onInitiateReply for a config-mem-stream read. */
    onInitiateReply(sm, stream) {
        const ctx = stream.context;
        if (!ctx || !this._ownsContext(ctx)) return;
        if (ctx.phase !== CONFIG_MEM_STREAM_PHASE.WAIT_INITIATE_REPLY) return;
        // Peer accepted — emit the Read Stream Reply OK datagram next, then
        // pump data. Mirrors C reference phase sequencing
        // (SEND_REPLY_DATAGRAM → PUMPING → SEND_COMPLETE).
        ctx.startAddress = ctx.startAddress ?? ctx.address;
        ctx.phase = CONFIG_MEM_STREAM_PHASE.SEND_REPLY_DATAGRAM;
    }

    /** Pump pending streams — called from the main run loop each tick. */
    pump(sm) {
        for (const ctx of this._table) {
            if (ctx.phase === CONFIG_MEM_STREAM_PHASE.IDLE) continue;
            if (sm.outgoing.valid) return;     // prior send still pending
            this._pumpOne(sm, ctx);
        }
    }

    _pumpOne(sm, ctx) {
        // pump() runs outside the main-SM dispatch cycle. We need sm.node set
        // so stream-handler / datagram loaders can read sm.node.alias / id,
        // but we must NOT leak that assignment back into the main SM — it
        // would break the main loop's invariant (msg==null ⟺ node==null),
        // causing the next incoming pop to be discarded by enumNext.
        const savedNode = sm.node;
        sm.node = ctx.node;
        try {
            this._pumpOneImpl(sm, ctx);
        } finally {
            sm.node = savedNode;
        }
    }

    _pumpOneImpl(sm, ctx) {
        switch (ctx.phase) {
            case CONFIG_MEM_STREAM_PHASE.SEND_REPLY_DATAGRAM:
                this._emitReadReplyOkDatagram(sm, ctx);
                ctx.phase = CONFIG_MEM_STREAM_PHASE.PUMPING;
                return;

            case CONFIG_MEM_STREAM_PHASE.PUMPING: {
                const stream = ctx.stream;
                if (!stream) return;
                if (ctx.remainingBytes === 0) {
                    ctx.phase = CONFIG_MEM_STREAM_PHASE.SEND_COMPLETE;
                    return;
                }
                if (stream.bytesRemaining <= 0) return;   // awaiting Proceed
                // Cap at LEN_MESSAGE_BYTES_STREAM - 1 to leave room for the
                // DID prefix byte in the outgoing stream message payload
                // (mirrors OpenLcbCLib protocol_config_mem_stream_handler.c
                // _pump_next_chunk: max_payload = LEN_MESSAGE_BYTES_STREAM - 1).
                const maxChunk = LEN_MESSAGE_BYTES_STREAM - 1;
                const chunkSize = Math.min(ctx.remainingBytes, stream.bytesRemaining, maxChunk);
                const buffer = new Uint8Array(chunkSize);
                const readCount = ctx.readFunc
                    ? ctx.readFunc(ctx.node, ctx.address, chunkSize, buffer)
                    : 0;
                if (readCount <= 0) {
                    // readFunc refused to produce any bytes — real error.
                    this._d.streamHandler.sendTerminate(sm, stream, ERROR_TEMPORARY_TRANSFER_ERROR);
                    this._emitReadReplyFailDatagram(sm, ctx, ERROR_TEMPORARY_TRANSFER_ERROR);
                    this._freeContext(ctx);
                    return;
                }
                // Short read (readCount < chunkSize) is treated as end-of-space:
                // send what we got, mark remaining as fully consumed so the next
                // pump tick transitions to SEND_COMPLETE. This guards against
                // off-by-one `highestAddress` misconfiguration in the host.
                const sendSize = readCount;
                this._d.streamHandler.sendData(sm, stream, buffer, sendSize);
                ctx.address += sendSize;
                if (readCount < chunkSize) {
                    ctx.remainingBytes = 0;
                } else {
                    ctx.remainingBytes -= sendSize;
                }
                return;
            }

            case CONFIG_MEM_STREAM_PHASE.SEND_COMPLETE:
                this._d.streamHandler.sendComplete(sm, ctx.stream);
                this._freeContext(ctx);
                return;

            case CONFIG_MEM_STREAM_PHASE.WRITE_SEND_REPLY:
                this._emitWriteReplyOkDatagram(sm, ctx);
                this._freeContext(ctx);
                return;

            default:
                return;
        }
    }

    /** Call from stream handler's onDataReceived for a config-mem-stream write. */
    onDataReceived(sm, stream) {
        const ctx = stream.context;
        if (!ctx || !this._ownsContext(ctx) || !ctx.isWrite) return;
        if (ctx.phase !== CONFIG_MEM_STREAM_PHASE.WRITE_RECEIVING) {
            ctx.phase = CONFIG_MEM_STREAM_PHASE.WRITE_RECEIVING;
        }
        // Incoming data bytes live in payload[1..payloadCount-1] of the
        // stream-send message (payload[0] = DID).
        const msg = sm.incoming.msg;
        const dataLen = msg.payloadCount - 1;
        if (dataLen <= 0 || !ctx.writeFunc) return;

        const data = msg.payload.subarray(1, 1 + dataLen);
        const written = ctx.writeFunc(ctx.node, ctx.address, dataLen, data);
        ctx.address += written;
    }

    /** Call from stream handler's onComplete for a config-mem-stream transfer. */
    onComplete(sm, stream) {
        const ctx = stream.context;
        if (!ctx || !this._ownsContext(ctx)) return;

        if (ctx.isWrite) {
            this._emitWriteReplyOkDatagram(sm, ctx);
        }
        this._freeContext(ctx);
    }

    _ownsContext(ctx) {
        return this._table.includes(ctx);
    }

    // -------------------------------------------------------------------------
    // Reply-datagram builders
    // -------------------------------------------------------------------------

    _emitReadReplyOkDatagram(sm, ctx) {
        this._emitReplyDatagram(sm, ctx, ctx.replyOrigCmd + CONFIG_MEM_REPLY_OK_OFFSET, null);
    }

    _emitReadReplyFailDatagram(sm, ctx, errorCode) {
        this._emitReplyDatagram(sm, ctx, ctx.replyOrigCmd + CONFIG_MEM_REPLY_FAIL_OFFSET, errorCode);
    }

    _emitWriteReplyOkDatagram(sm, ctx) {
        this._emitReplyDatagram(sm, ctx, ctx.replyOrigCmd + CONFIG_MEM_REPLY_OK_OFFSET, null);
    }

    /**
     * Read Stream Reply OK/Fail datagram. Per MemCfg §4.6 (mirrors C ref
     * protocol_config_mem_stream_handler.c `_load_reply_ok_datagram`):
     *   byte 0: 0x20
     *   byte 1: reply cmd (e.g. 0x70/0x71/0x72/0x73, +0x08 for fail)
     *   bytes 2-5: starting address (the request's, not the advanced one)
     *   byte 6 (byte-6 encoding only): space byte
     *   next byte: source stream ID (ours)
     *   next byte: destination stream ID (remote's)
     *   next 4 bytes: total byte count (from the original request)
     *   [on fail] + 2-byte error code at byte 6 (non-byte6) or 7 (byte6)
     */
    _emitReplyDatagram(sm, ctx, replyCmd, errorCode) {
        sm.outgoing.msg.payloadCount = 0;
        // Reply is sent from the owning node back to the requester — use the
        // remote identity captured at Phase-1 time, not sm.incoming (which
        // now belongs to a different dispatch cycle).
        loadOpenlcbMessage(
            sm.outgoing.msg,
            ctx.node.alias, ctx.node.id,
            ctx.remoteAlias, ctx.remoteNodeId,
            MTI_DATAGRAM
        );
        copyByteToPayload(sm.outgoing.msg, CONFIG_MEM_CONFIGURATION, 0);
        copyByteToPayload(sm.outgoing.msg, replyCmd, 1);
        copyDwordToPayload(sm.outgoing.msg, ctx.startAddress ?? 0, 2);

        let off = 6;
        if (ctx.replyEncoding === ADDRESS_SPACE_ENCODING.IN_BYTE_6) {
            copyByteToPayload(sm.outgoing.msg, ctx.replySpaceByte, off++);
        }
        if (errorCode !== null) {
            copyWordToPayload(sm.outgoing.msg, errorCode, off);
            sm.outgoing.msg.payloadCount = off + 2;
        } else {
            const srcSid = ctx.stream ? ctx.stream.sourceStreamId : 0;
            const dstSid = ctx.stream ? ctx.stream.destStreamId   : 0;
            copyByteToPayload(sm.outgoing.msg, srcSid, off++);
            copyByteToPayload(sm.outgoing.msg, dstSid, off++);
            copyDwordToPayload(sm.outgoing.msg, ctx.totalBytes, off);
            sm.outgoing.msg.payloadCount = off + 4;
        }
        sm.outgoing.valid = true;
    }
}

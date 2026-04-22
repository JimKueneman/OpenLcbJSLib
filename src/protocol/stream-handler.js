// Ported from OpenLcbCLib/src/openlcb/protocol_stream_handler.[hc].
//
// OpenLCB Stream Transport: initiate request/reply, data send with flow
// control (Proceed windows), and complete. A stream state table tracks per-
// stream Source/Destination IDs, remote identity, buffer window, and byte
// counters.

import {
    MTI_STREAM_INIT_REPLY,
    MTI_STREAM_INIT_REQUEST,
    MTI_STREAM_SEND,
    MTI_STREAM_PROCEED,
    MTI_STREAM_COMPLETE,
    MTI_TERMINATE_DUE_TO_ERROR,
    STREAM_REPLY_ACCEPT,
    STREAM_ID_RESERVED,
    LEN_MESSAGE_BYTES_STREAM,
    ERROR_PERMANENT_STREAMS_NOT_SUPPORTED,
    ERROR_TEMPORARY_BUFFER_UNAVAILABLE,
} from '../openlcb/defines.js';
import {
    loadOpenlcbMessage,
    clearOpenlcbMessagePayload,
    copyByteToPayload,
    copyWordToPayload,
    extractByteFromPayload,
    extractWordFromPayload,
} from '../openlcb/utilities.js';

export const STREAM_STATE = Object.freeze({
    CLOSED:    0,
    INITIATED: 1,
    OPEN:      2,
});

// =============================================================================

export class ProtocolStreamHandler {
    /**
     * @param {Object} [deps]
     * @param {number} [deps.maxConcurrentStreams=4]
     * @param {(sm, stream) => boolean} [deps.onInitiateRequest]
     * @param {(sm, stream) => void}    [deps.onInitiateReply]
     * @param {(sm, stream) => void}    [deps.onDataReceived]
     * @param {(sm, stream) => void}    [deps.onDataProceed]
     * @param {(sm, stream) => void}    [deps.onComplete]
     */
    constructor(deps = {}) {
        this._d = deps;
        this._table = new Array(deps.maxConcurrentStreams ?? 4).fill(null).map(() => ({
            state: STREAM_STATE.CLOSED,
            sourceStreamId: 0,
            destStreamId: 0,
            remoteNodeId: 0n,
            remoteAlias: 0,
            maxBufferSize: 0,
            bytesTransferred: 0,
            bytesRemaining: 0,
            isSource: false,
            contentUid: new Uint8Array(6),
            context: null,
        }));
        this._nextDestStreamId = 0;
        this._nextSourceStreamId = 0;
    }

    // -------------------------------------------------------------------------
    // Stream table management
    // -------------------------------------------------------------------------

    _allocateStream() {
        for (const s of this._table) {
            if (s.state === STREAM_STATE.CLOSED) return s;
        }
        return null;
    }

    _freeStream(stream) {
        stream.state = STREAM_STATE.CLOSED;
        stream.remoteNodeId = 0n;
        stream.remoteAlias = 0;
        stream.sourceStreamId = 0;
        stream.destStreamId = 0;
        stream.bytesTransferred = 0;
        stream.bytesRemaining = 0;
        stream.maxBufferSize = 0;
        stream.isSource = false;
        stream.contentUid.fill(0);
        stream.context = null;
    }

    /**
     * Find a stream by (remoteAlias, streamId). Matches on alias rather than
     * node ID because the CAN RX layer leaves msg.sourceId=0n on stream and
     * addressed single-frame messages — only sourceAlias is guaranteed
     * populated. `matchSourceId` selects source vs dest stream ID.
     */
    _findStream(remoteAlias, streamId, matchSourceId) {
        for (const s of this._table) {
            if (s.state === STREAM_STATE.CLOSED) continue;
            if (s.remoteAlias !== remoteAlias) continue;
            const id = matchSourceId ? s.sourceStreamId : s.destStreamId;
            if (id === streamId) return s;
        }
        return null;
    }

    _assignDestStreamId() {
        const id = this._nextDestStreamId;
        this._nextDestStreamId = (this._nextDestStreamId + 1) >= STREAM_ID_RESERVED ? 0 : this._nextDestStreamId + 1;
        return id;
    }

    _assignSourceStreamId() {
        const id = this._nextSourceStreamId;
        this._nextSourceStreamId = (this._nextSourceStreamId + 1) >= STREAM_ID_RESERVED ? 0 : this._nextSourceStreamId + 1;
        return id;
    }

    // -------------------------------------------------------------------------
    // Outgoing message builders
    // -------------------------------------------------------------------------

    _loadInitiateReply(sm, maxBufferSize, flagsOrError, sourceStreamId, destStreamId) {
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_STREAM_INIT_REPLY
        );
        clearOpenlcbMessagePayload(sm.outgoing.msg);
        copyWordToPayload(sm.outgoing.msg, maxBufferSize, 0);
        copyWordToPayload(sm.outgoing.msg, flagsOrError, 2);
        copyByteToPayload(sm.outgoing.msg, sourceStreamId, 4);
        copyByteToPayload(sm.outgoing.msg, destStreamId, 5);
        sm.outgoing.msg.payloadCount = 6;
        sm.outgoing.valid = true;
    }

    _loadInitiateRequest(sm, proposedBufferSize, sourceStreamId, suggestedDestStreamId, destAlias, destId, contentUid) {
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            destAlias, destId,
            MTI_STREAM_INIT_REQUEST
        );
        clearOpenlcbMessagePayload(sm.outgoing.msg);
        copyWordToPayload(sm.outgoing.msg, proposedBufferSize, 0);
        copyWordToPayload(sm.outgoing.msg, 0x0000, 2);
        copyByteToPayload(sm.outgoing.msg, sourceStreamId, 4);

        if (contentUid) {
            copyByteToPayload(sm.outgoing.msg, suggestedDestStreamId, 5);
            for (let i = 0; i < 6; i++) copyByteToPayload(sm.outgoing.msg, contentUid[i], 6 + i);
            sm.outgoing.msg.payloadCount = 12;
        } else if (suggestedDestStreamId !== STREAM_ID_RESERVED) {
            copyByteToPayload(sm.outgoing.msg, suggestedDestStreamId, 5);
            sm.outgoing.msg.payloadCount = 6;
        } else {
            sm.outgoing.msg.payloadCount = 5;
        }
        sm.outgoing.valid = true;
    }

    _loadDataProceed(sm, stream) {
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_STREAM_PROCEED
        );
        clearOpenlcbMessagePayload(sm.outgoing.msg);
        copyByteToPayload(sm.outgoing.msg, stream.sourceStreamId, 0);
        copyByteToPayload(sm.outgoing.msg, stream.destStreamId, 1);
        sm.outgoing.msg.payloadCount = 2;
        sm.outgoing.valid = true;
    }

    _loadDataSend(sm, stream, data, dataLen) {
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            stream.remoteAlias, stream.remoteNodeId,
            MTI_STREAM_SEND
        );
        clearOpenlcbMessagePayload(sm.outgoing.msg);
        copyByteToPayload(sm.outgoing.msg, stream.destStreamId, 0);
        for (let i = 0; i < dataLen; i++) copyByteToPayload(sm.outgoing.msg, data[i], 1 + i);
        sm.outgoing.msg.payloadCount = 1 + dataLen;
        sm.outgoing.valid = true;
    }

    _loadDataComplete(sm, stream) {
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            stream.remoteAlias, stream.remoteNodeId,
            MTI_STREAM_COMPLETE
        );
        clearOpenlcbMessagePayload(sm.outgoing.msg);
        copyByteToPayload(sm.outgoing.msg, stream.sourceStreamId, 0);
        copyByteToPayload(sm.outgoing.msg, stream.destStreamId, 1);

        if (stream.bytesTransferred > 0) {
            // 7-byte form: SID + DID + flags(2) + count(3)
            copyWordToPayload(sm.outgoing.msg, 0x0000, 2);
            copyByteToPayload(sm.outgoing.msg, (stream.bytesTransferred >>> 16) & 0xFF, 4);
            copyByteToPayload(sm.outgoing.msg, (stream.bytesTransferred >>>  8) & 0xFF, 5);
            copyByteToPayload(sm.outgoing.msg,  stream.bytesTransferred         & 0xFF, 6);
            sm.outgoing.msg.payloadCount = 7;
        } else {
            sm.outgoing.msg.payloadCount = 2;
        }
        sm.outgoing.valid = true;
    }

    _loadTerminateDueToError(sm, stream, errorCode, rejectedMti) {
        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            stream.remoteAlias, stream.remoteNodeId,
            MTI_TERMINATE_DUE_TO_ERROR
        );
        clearOpenlcbMessagePayload(sm.outgoing.msg);
        copyWordToPayload(sm.outgoing.msg, errorCode, 0);
        copyWordToPayload(sm.outgoing.msg, rejectedMti, 2);
        sm.outgoing.msg.payloadCount = 4;
        sm.outgoing.valid = true;
    }

    // -------------------------------------------------------------------------
    // Incoming message handlers (public MTI entry points)
    // -------------------------------------------------------------------------

    initiateRequest(sm) {
        const msg = sm.incoming.msg;
        const proposedBufferSize = extractWordFromPayload(msg, 0);
        const sourceStreamId = extractByteFromPayload(msg, 4);

        if (!this._d.onInitiateRequest) {
            this._loadInitiateReply(sm, 0, ERROR_PERMANENT_STREAMS_NOT_SUPPORTED, sourceStreamId, 0);
            return;
        }

        const stream = this._allocateStream();
        if (!stream) {
            this._loadInitiateReply(sm, 0, ERROR_TEMPORARY_BUFFER_UNAVAILABLE, sourceStreamId, 0);
            return;
        }

        stream.state = STREAM_STATE.INITIATED;
        stream.sourceStreamId = sourceStreamId;
        stream.destStreamId = this._assignDestStreamId();
        stream.remoteNodeId = msg.sourceId;
        stream.remoteAlias = msg.sourceAlias;
        stream.isSource = false;
        stream.bytesTransferred = 0;
        stream.maxBufferSize = Math.min(proposedBufferSize, LEN_MESSAGE_BYTES_STREAM);
        stream.bytesRemaining = stream.maxBufferSize;

        if (msg.payloadCount >= 12) {
            for (let i = 0; i < 6; i++) stream.contentUid[i] = extractByteFromPayload(msg, 6 + i);
        }

        const accepted = this._d.onInitiateRequest(sm, stream);
        if (accepted) {
            stream.state = STREAM_STATE.OPEN;
            this._loadInitiateReply(sm, stream.maxBufferSize, STREAM_REPLY_ACCEPT, stream.sourceStreamId, stream.destStreamId);
        } else {
            const sid = stream.sourceStreamId;
            this._freeStream(stream);
            this._loadInitiateReply(sm, 0, ERROR_PERMANENT_STREAMS_NOT_SUPPORTED, sid, 0);
        }
    }

    initiateReply(sm) {
        const msg = sm.incoming.msg;
        const negotiatedBufferSize = extractWordFromPayload(msg, 0);
        const flags = extractWordFromPayload(msg, 2);
        const sourceStreamId = extractByteFromPayload(msg, 4);
        const destStreamId = extractByteFromPayload(msg, 5);

        const stream = this._findStream(msg.sourceAlias, sourceStreamId, true);
        if (!stream) return;

        const accepted = negotiatedBufferSize > 0 && ((flags & STREAM_REPLY_ACCEPT) !== 0 || flags === 0x0000);
        if (accepted) {
            stream.state = STREAM_STATE.OPEN;
            stream.destStreamId = destStreamId;
            stream.maxBufferSize = negotiatedBufferSize;
            stream.bytesRemaining = negotiatedBufferSize;
            this._d.onInitiateReply?.(sm, stream);
        } else {
            this._d.onInitiateReply?.(sm, stream);
            this._freeStream(stream);
        }
    }

    dataSend(sm) {
        const msg = sm.incoming.msg;
        const destStreamId = extractByteFromPayload(msg, 0);

        const stream = this._findStream(msg.sourceAlias, destStreamId, false);
        if (!stream || stream.state !== STREAM_STATE.OPEN) return;

        const dataLen = msg.payloadCount > 1 ? msg.payloadCount - 1 : 0;
        stream.bytesTransferred += dataLen;
        stream.bytesRemaining = Math.max(0, stream.bytesRemaining - dataLen);

        this._d.onDataReceived?.(sm, stream);

        if (stream.bytesRemaining === 0) {
            stream.bytesRemaining = stream.maxBufferSize;
            this._loadDataProceed(sm, stream);
        }
    }

    dataProceed(sm) {
        const msg = sm.incoming.msg;
        const sourceStreamId = extractByteFromPayload(msg, 0);

        const stream = this._findStream(msg.sourceAlias, sourceStreamId, true);
        if (!stream || stream.state !== STREAM_STATE.OPEN) return;

        stream.bytesRemaining += stream.maxBufferSize;
        this._d.onDataProceed?.(sm, stream);
    }

    dataComplete(sm) {
        const msg = sm.incoming.msg;
        const sourceStreamId = extractByteFromPayload(msg, 0);
        const destStreamId = extractByteFromPayload(msg, 1);

        let stream = this._findStream(msg.sourceAlias, sourceStreamId, true);
        if (!stream) stream = this._findStream(msg.sourceAlias, destStreamId, false);
        if (!stream) return;

        this._d.onComplete?.(sm, stream);
        this._freeStream(stream);
    }

    handleTerminateDueToError(sm) {
        const msg = sm.incoming.msg;
        if (msg.payloadCount < 4) return;
        const rejectedMti = extractWordFromPayload(msg, 2);
        if (rejectedMti !== MTI_STREAM_SEND && rejectedMti !== MTI_STREAM_PROCEED) return;

        for (const stream of this._table) {
            if (stream.state === STREAM_STATE.CLOSED) continue;
            if (stream.remoteNodeId !== msg.sourceId) continue;
            this._d.onComplete?.(sm, stream);
            this._freeStream(stream);
        }
    }

    // -------------------------------------------------------------------------
    // Source-side outbound API
    // -------------------------------------------------------------------------

    initiateOutbound(sm, destAlias, destId, proposedBufferSize, suggestedDestStreamId = STREAM_ID_RESERVED, contentUid = null) {
        const stream = this._allocateStream();
        if (!stream) return null;

        stream.state = STREAM_STATE.INITIATED;
        stream.sourceStreamId = this._assignSourceStreamId();
        stream.destStreamId = 0;
        stream.remoteNodeId = destId;
        stream.remoteAlias = destAlias;
        stream.isSource = true;
        stream.maxBufferSize = proposedBufferSize;
        stream.bytesTransferred = 0;
        stream.bytesRemaining = 0;

        if (contentUid) {
            for (let i = 0; i < 6; i++) stream.contentUid[i] = contentUid[i];
        }

        this._loadInitiateRequest(sm, proposedBufferSize, stream.sourceStreamId, suggestedDestStreamId, destAlias, destId, contentUid);
        return stream;
    }

    sendData(sm, stream, data, dataLen) {
        if (stream.state !== STREAM_STATE.OPEN || !stream.isSource) return false;
        if (dataLen > stream.bytesRemaining) return false;
        this._loadDataSend(sm, stream, data, dataLen);
        stream.bytesTransferred += dataLen;
        stream.bytesRemaining -= dataLen;
        return true;
    }

    sendComplete(sm, stream) {
        this._loadDataComplete(sm, stream);
        this._freeStream(stream);
    }

    sendTerminate(sm, stream, errorCode) {
        const rejectedMti = stream.isSource ? MTI_STREAM_PROCEED : MTI_STREAM_SEND;
        this._loadTerminateDueToError(sm, stream, errorCode, rejectedMti);
        this._freeStream(stream);
    }

    sendEarlyProceed(sm, stream) {
        if (stream.state !== STREAM_STATE.OPEN || stream.isSource) return false;
        this._loadDataProceed(sm, stream);
        return true;
    }
}

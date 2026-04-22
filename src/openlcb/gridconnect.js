// Ported from OpenLcbCLib/src/openlcb/openlcb_gridconnect.[hc]
//
// GridConnect ASCII codec for CAN frames:
//
//   :X<8-hex-ID>N<hex-data>;
//   Example: :X19170640N0501010107015555;
//
// The C version uses a static parser context (not thread-safe). Here the
// parser is a class so each WebSocket connection / test harness has its own
// independent state. The encoder stays as a pure function.
//
// We accept both string and byte (Number) input; WebSocket text frames
// deliver strings, but the conformance tests feed byte sequences.

import { LEN_CAN_BYTE_ARRAY, createCanMsg } from '../drivers/can/types.js';

const STATE_SYNC_START       = 0;
const STATE_SYNC_FIND_HEADER = 2;
const STATE_SYNC_FIND_DATA   = 4;

const IDENTIFIER_START_POS = 2;   // first char after ':X'
const IDENTIFIER_LEN       = 8;
const NORMAL_FLAG_POS      = 10;  // position of 'N'
const DATA_START_POS       = 11;
const HEADER_LEN           = 12;  // ':X'+8+'N'+';' = 12 chars before data
const MAX_GRID_CONNECT_LEN = 29;  // :X(8)N(16); + NUL

function isValidHexChar(code) {
    return (code >= 0x30 && code <= 0x39) || // 0-9
           (code >= 0x41 && code <= 0x46) || // A-F
           (code >= 0x61 && code <= 0x66);   // a-f
}

// =============================================================================
// Streaming parser
// =============================================================================

export class GridConnectParser {
    constructor() {
        this._state = STATE_SYNC_START;
        this._idx = 0;
        this._buf = new Uint8Array(MAX_GRID_CONNECT_LEN);
    }

    /** Reset the parser back to looking for ':X'. */
    reset() {
        this._state = STATE_SYNC_START;
        this._idx = 0;
    }

    /**
     * Feed one byte (0-255 Number) or one character (length-1 string) into
     * the parser. Returns a completed GridConnect string (including the
     * terminating ';') when a full frame has been parsed, or null otherwise.
     *
     * Malformed input auto-resets to SYNC_START without surfacing an error.
     */
    feedByte(input) {
        const c = typeof input === 'string' ? input.charCodeAt(0) : (input & 0xFF);

        switch (this._state) {
            case STATE_SYNC_START:
                if (c === 0x58 /* 'X' */ || c === 0x78 /* 'x' */) {
                    this._idx = 0;
                    this._buf[this._idx++] = 0x3A; // ':'
                    this._buf[this._idx++] = c;
                    this._state = STATE_SYNC_FIND_HEADER;
                }
                return null;

            case STATE_SYNC_FIND_HEADER:
                if (this._idx > NORMAL_FLAG_POS) {
                    this._state = STATE_SYNC_START;
                    return null;
                }
                if (c === 0x4E /* 'N' */ || c === 0x6E /* 'n' */) {
                    if (this._idx === NORMAL_FLAG_POS) {
                        this._buf[this._idx++] = c;
                        this._state = STATE_SYNC_FIND_DATA;
                    } else {
                        this._state = STATE_SYNC_START;
                    }
                } else if (!isValidHexChar(c)) {
                    this._state = STATE_SYNC_START;
                } else {
                    this._buf[this._idx++] = c;
                }
                return null;

            case STATE_SYNC_FIND_DATA:
                if (c === 0x3B /* ';' */) {
                    // Data portion must be an even number of hex chars.
                    // Equivalent C check: (_receive_buffer_index + 1) % 2 != 0.
                    // With HEADER_LEN = 12 (even), an odd _idx means an odd data-char count.
                    if ((this._idx + 1) % 2 !== 0) {
                        this._state = STATE_SYNC_START;
                        return null;
                    }
                    this._buf[this._idx] = c;
                    this._state = STATE_SYNC_START;
                    // Convert the populated prefix of _buf to a JS string.
                    const len = this._idx + 1;
                    let out = '';
                    for (let i = 0; i < len; i++) {
                        out += String.fromCharCode(this._buf[i]);
                    }
                    return out;
                }
                if (!isValidHexChar(c)) {
                    this._state = STATE_SYNC_START;
                    return null;
                }
                this._buf[this._idx++] = c;
                if (this._idx > MAX_GRID_CONNECT_LEN - 1) {
                    this._state = STATE_SYNC_START;
                }
                return null;

            default:
                this._state = STATE_SYNC_START;
                return null;
        }
    }

    /**
     * Convenience: feed a chunk (string or Uint8Array) and invoke `onFrame`
     * for every completed GridConnect frame found in the chunk.
     */
    feed(chunk, onFrame) {
        if (typeof chunk === 'string') {
            for (let i = 0; i < chunk.length; i++) {
                const frame = this.feedByte(chunk.charCodeAt(i));
                if (frame) onFrame(frame);
            }
        } else {
            for (let i = 0; i < chunk.length; i++) {
                const frame = this.feedByte(chunk[i]);
                if (frame) onFrame(frame);
            }
        }
    }
}

// =============================================================================
// Decoder: GridConnect string → CAN frame
// =============================================================================

/**
 * Parse a complete GridConnect string (as returned by the parser) into a CAN
 * frame object. Does NOT validate format — the string is assumed to have come
 * from the streaming parser.
 *
 * Mutates `canMsg` in place when provided, otherwise returns a fresh frame.
 */
export function toCanMsg(gridconnectStr, canMsg = null) {
    const msg = canMsg ?? createCanMsg();
    const len = gridconnectStr.length;

    if (len < HEADER_LEN) {
        msg.identifier = 0;
        msg.payloadCount = 0;
        return msg;
    }

    const idStr = gridconnectStr.slice(IDENTIFIER_START_POS, IDENTIFIER_START_POS + IDENTIFIER_LEN);
    msg.identifier = parseInt(idStr, 16) >>> 0;

    // Exclude the trailing ';' when counting data chars. Input from the parser
    // always ends with ';'; handwritten strings might not.
    const endIndex = gridconnectStr.endsWith(';') ? len - 1 : len;
    const dataCharCount = endIndex - DATA_START_POS;
    const byteCount = Math.min(dataCharCount >> 1, LEN_CAN_BYTE_ARRAY);
    msg.payloadCount = byteCount;

    for (let i = 0; i < byteCount; i++) {
        const off = DATA_START_POS + (i << 1);
        msg.payload[i] = parseInt(gridconnectStr.slice(off, off + 2), 16) & 0xFF;
    }
    // Zero any trailing bytes.
    for (let i = byteCount; i < LEN_CAN_BYTE_ARRAY; i++) {
        msg.payload[i] = 0;
    }

    return msg;
}

// =============================================================================
// Encoder: CAN frame → GridConnect string
// =============================================================================

const HEX = '0123456789ABCDEF';

function hex8(n) {
    const v = n >>> 0;
    return (
        HEX[(v >>> 28) & 0xF] +
        HEX[(v >>> 24) & 0xF] +
        HEX[(v >>> 20) & 0xF] +
        HEX[(v >>> 16) & 0xF] +
        HEX[(v >>> 12) & 0xF] +
        HEX[(v >>>  8) & 0xF] +
        HEX[(v >>>  4) & 0xF] +
        HEX[ v         & 0xF]
    );
}

function hex2(b) {
    return HEX[(b >>> 4) & 0xF] + HEX[b & 0xF];
}

/**
 * Format a CAN frame as an uppercase GridConnect string, e.g.
 * ":X19170640N0501010107015555;".
 */
export function fromCanMsg(canMsg) {
    let out = ':X' + hex8(canMsg.identifier) + 'N';
    const n = Math.min(canMsg.payloadCount, LEN_CAN_BYTE_ARRAY);
    for (let i = 0; i < n; i++) {
        out += hex2(canMsg.payload[i]);
    }
    return out + ';';
}

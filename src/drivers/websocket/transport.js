// New module (no C equivalent) — WebSocket-to-GridConnect glue.
//
// On the wire a GridConnect-over-WebSocket stream looks like ASCII CAN frames:
//   :X19170640N0501010107015555;\n:X1CDD0641N...;\n
//
// This module owns the WebSocket connection, streams incoming text through
// the GridConnectParser, decodes each completed frame to a CAN frame, and
// hands it to a `CanRxStatemachine.handleFrame()` for classification. On the
// TX side it accepts CAN frames (from CanTxMessageHandler) and ships them
// back out as GridConnect strings.
//
// Auto-reconnect is optional — when enabled, drops fire an exponential back-
// off reconnect. Lifecycle callbacks (onConnect / onDisconnect / onError) let
// the application track the connection state.

import { GridConnectParser, fromCanMsg, toCanMsg } from '../../openlcb/gridconnect.js';

const DEFAULT_RECONNECT_MIN_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

export const WS_STATE = Object.freeze({
    DISCONNECTED: 'disconnected',
    CONNECTING:   'connecting',
    CONNECTED:    'connected',
    CLOSING:      'closing',
});

export class WebSocketTransport {
    /**
     * @param {Object} opts
     * @param {string}   opts.url                    required — WebSocket URL (ws:// or wss://)
     * @param {(canMsg) => void} opts.onCanFrame     required — called for every decoded CAN frame
     * @param {() => void}       [opts.onConnect]    optional lifecycle hook
     * @param {(wasClean, code, reason) => void} [opts.onDisconnect]
     * @param {(err) => void}    [opts.onError]
     * @param {boolean}  [opts.autoReconnect=true]
     * @param {number}   [opts.reconnectMinMs=500]
     * @param {number}   [opts.reconnectMaxMs=30000]
     * @param {Function} [opts.WebSocketImpl]  optional — inject a WebSocket ctor
     *                                         for testing (defaults to the global).
     */
    constructor(opts) {
        if (!opts.url) throw new Error('WebSocketTransport: url is required');
        if (!opts.onCanFrame) throw new Error('WebSocketTransport: onCanFrame is required');

        this._url = opts.url;
        this._onCanFrame = opts.onCanFrame;
        this._onConnect = opts.onConnect ?? null;
        this._onDisconnect = opts.onDisconnect ?? null;
        this._onError = opts.onError ?? null;
        this._autoReconnect = opts.autoReconnect ?? true;
        this._reconnectMinMs = opts.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS;
        this._reconnectMaxMs = opts.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
        this._WebSocketImpl = opts.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
        // JMRI and most GridConnect-over-TCP hubs expect newline-terminated
        // frames. Default to '\n'; set to '' to send raw `:X...;` with no
        // terminator.
        this._frameTerminator = opts.frameTerminator ?? '\n';

        this._parser = new GridConnectParser();
        this._ws = null;
        this._state = WS_STATE.DISCONNECTED;
        this._reconnectAttempt = 0;
        this._reconnectTimer = null;
        this._manualClose = false;
    }

    get state() { return this._state; }

    /** Open the connection. No-op if already connecting / connected. */
    connect() {
        if (!this._WebSocketImpl) {
            throw new Error('WebSocketTransport: no WebSocket implementation available (pass opts.WebSocketImpl)');
        }
        if (this._state === WS_STATE.CONNECTING || this._state === WS_STATE.CONNECTED) return;

        this._manualClose = false;
        this._openSocket();
    }

    /** Close the connection. Suppresses auto-reconnect. */
    disconnect(code, reason) {
        this._manualClose = true;
        this._clearReconnect();
        if (this._ws && (this._state === WS_STATE.CONNECTING || this._state === WS_STATE.CONNECTED)) {
            this._state = WS_STATE.CLOSING;
            try { this._ws.close(code, reason); } catch (e) { /* ignore */ }
        } else {
            this._state = WS_STATE.DISCONNECTED;
        }
    }

    /**
     * Send a CAN frame as a GridConnect ASCII string. Returns false if the
     * socket isn't open yet.
     */
    send(canMsg) {
        if (this._state !== WS_STATE.CONNECTED || !this._ws) return false;
        try {
            this._ws.send(fromCanMsg(canMsg) + this._frameTerminator);
            return true;
        } catch (e) {
            this._reportError(e);
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    _openSocket() {
        this._state = WS_STATE.CONNECTING;
        this._parser.reset();

        let ws;
        try {
            ws = new this._WebSocketImpl(this._url);
        } catch (e) {
            this._reportError(e);
            this._scheduleReconnect();
            return;
        }
        this._ws = ws;

        ws.onopen = () => {
            this._state = WS_STATE.CONNECTED;
            this._reconnectAttempt = 0;
            this._onConnect?.();
        };

        ws.onmessage = (event) => {
            this._handleIncoming(event.data);
        };

        ws.onerror = (err) => {
            this._reportError(err);
        };

        ws.onclose = (event) => {
            const wasClean = typeof event?.wasClean === 'boolean' ? event.wasClean : true;
            const code = event?.code;
            const reason = event?.reason;
            this._state = WS_STATE.DISCONNECTED;
            this._ws = null;
            this._onDisconnect?.(wasClean, code, reason);

            if (!this._manualClose && this._autoReconnect) {
                this._scheduleReconnect();
            }
        };
    }

    _handleIncoming(data) {
        // WebSockets may deliver text (string) or binary (ArrayBuffer / Blob).
        // GridConnect is always text; binary frames are ignored.
        if (typeof data === 'string') {
            this._parser.feed(data, (frameStr) => this._processFrame(frameStr));
        } else if (data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(data);
            this._parser.feed(bytes, (frameStr) => this._processFrame(frameStr));
        }
        // Ignore Blobs — the JMRI hub and standard gateways always send text.
    }

    _processFrame(gcString) {
        try {
            const canMsg = toCanMsg(gcString);
            this._onCanFrame(canMsg);
        } catch (e) {
            this._reportError(e);
        }
    }

    _reportError(err) {
        if (this._onError) this._onError(err);
    }

    _scheduleReconnect() {
        if (!this._autoReconnect || this._manualClose) return;
        if (this._reconnectTimer) return;

        const backoff = Math.min(
            this._reconnectMaxMs,
            this._reconnectMinMs * Math.pow(2, this._reconnectAttempt),
        );
        this._reconnectAttempt++;

        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (this._state === WS_STATE.DISCONNECTED && !this._manualClose) {
                this._openSocket();
            }
        }, backoff);
    }

    _clearReconnect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this._reconnectAttempt = 0;
    }
}

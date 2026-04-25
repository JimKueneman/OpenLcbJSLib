// WebSocket transport — byte/chunk pipe to a GridConnect WebSocket hub.
//
// Matches the Transport interface that OpenLcb.create() expects:
//   - async connect() — resolves when the socket opens
//   - async disconnect() — resolves when the socket closes
//   - send(payload) — throws TransportBusyError when not connected
//   - onMessage / onError / onStateChange — set by the runtime at construction
//
// This transport has zero protocol knowledge — payloads are forwarded
// as-is both ways.  Framing, parsing, and CAN conversion are above it.
//
// Auto-reconnect: when enabled, drops fire an exponential back-off.

import { TransportBusyError, TransportConnectError } from '../../openlcb/errors.js';

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
     * @param {object} opts
     * @param {string}   opts.url            WebSocket URL (ws:// or wss://)
     * @param {Function} [opts.WebSocketImpl] override the WebSocket ctor (Node, tests)
     * @param {boolean}  [opts.autoReconnect=true]
     * @param {number}   [opts.reconnectMinMs=500]
     * @param {number}   [opts.reconnectMaxMs=30000]
     */
    constructor(opts) {
        if (!opts?.url) throw new Error('WebSocketTransport: url is required');

        this._url = opts.url;
        this._WebSocketImpl = opts.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
        this._autoReconnect = opts.autoReconnect ?? true;
        this._reconnectMinMs = opts.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS;
        this._reconnectMaxMs = opts.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;

        this._ws = null;
        this._state = WS_STATE.DISCONNECTED;
        this._reconnectAttempt = 0;
        this._reconnectTimer = null;
        this._manualClose = false;

        // Runtime sets these after construction.  Unused until then.
        this.onMessage     = null;
        this.onError       = null;
        this.onStateChange = null;

        // Pending connect/disconnect promises.
        this._connectResolve = null;
        this._connectReject  = null;
        this._disconnectResolve = null;
    }

    get state() { return this._state; }

    /** Open the socket.  Resolves when connected, rejects on open failure. */
    connect() {
        if (this._state === WS_STATE.CONNECTED) return Promise.resolve();
        if (this._state === WS_STATE.CONNECTING) {
            // Coalesce — return the existing pending promise.
            return new Promise((res, rej) => {
                const prevRes = this._connectResolve, prevRej = this._connectReject;
                this._connectResolve = () => { prevRes?.(); res(); };
                this._connectReject  = (e) => { prevRej?.(e); rej(e); };
            });
        }
        if (!this._WebSocketImpl) {
            return Promise.reject(new TransportConnectError(
                'WebSocketTransport: no WebSocket implementation available (pass opts.WebSocketImpl)',
            ));
        }
        this._manualClose = false;
        return new Promise((resolve, reject) => {
            this._connectResolve = resolve;
            this._connectReject = reject;
            this._openSocket();
        });
    }

    /** Close the socket.  Resolves when closed.  Suppresses auto-reconnect. */
    disconnect(code, reason) {
        this._manualClose = true;
        this._clearReconnect();
        if (this._ws && (this._state === WS_STATE.CONNECTING || this._state === WS_STATE.CONNECTED)) {
            return new Promise((resolve) => {
                this._disconnectResolve = resolve;
                this._setState(WS_STATE.CLOSING);
                try { this._ws.close(code, reason); } catch (e) { /* ignore */ }
            });
        }
        this._setState(WS_STATE.DISCONNECTED);
        return Promise.resolve();
    }

    /**
     * Send a payload.  Throws TransportBusyError if not connected.
     * @param {string | ArrayBuffer | Uint8Array} payload
     */
    send(payload) {
        if (this._state !== WS_STATE.CONNECTED || !this._ws) {
            throw new TransportBusyError('WebSocketTransport.send: socket not connected');
        }
        try {
            this._ws.send(payload);
        } catch (e) {
            this._reportError(e);
            throw new TransportBusyError('WebSocketTransport.send: underlying send() failed', { cause: e });
        }
    }

    // ------------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------------

    _setState(newState) {
        if (this._state === newState) return;
        this._state = newState;
        this.onStateChange?.(newState);
    }

    _openSocket() {
        this._setState(WS_STATE.CONNECTING);

        let ws;
        try {
            ws = new this._WebSocketImpl(this._url);
        } catch (e) {
            this._reportError(e);
            this._rejectPendingConnect(new TransportConnectError('WebSocket ctor threw', { cause: e }));
            this._scheduleReconnect();
            return;
        }
        this._ws = ws;

        ws.onopen = () => {
            this._setState(WS_STATE.CONNECTED);
            this._reconnectAttempt = 0;
            this._connectResolve?.();
            this._connectResolve = null;
            this._connectReject = null;
        };

        ws.onmessage = (event) => {
            try {
                this.onMessage?.(event.data);
            } catch (e) {
                this._reportError(e);
            }
        };

        ws.onerror = (err) => this._reportError(err);

        ws.onclose = (event) => {
            const wasConnected = this._state === WS_STATE.CONNECTED;
            this._ws = null;
            this._setState(WS_STATE.DISCONNECTED);

            // Resolve any pending disconnect.
            this._disconnectResolve?.();
            this._disconnectResolve = null;

            // If we were still trying to connect and the socket closed,
            // reject the connect promise.
            if (!wasConnected) {
                this._rejectPendingConnect(new TransportConnectError(
                    `socket closed before open (code=${event?.code})`,
                ));
            }

            if (!this._manualClose && this._autoReconnect) {
                this._scheduleReconnect();
            }
        };
    }

    _reportError(err) {
        this.onError?.(err);
    }

    _rejectPendingConnect(err) {
        if (this._connectReject) {
            this._connectReject(err);
            this._connectResolve = null;
            this._connectReject = null;
        }
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

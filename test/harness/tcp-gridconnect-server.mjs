// Node-side GridConnect TCP server transport.
//
// OlcbCheckerClone (and many JMRI setups) connects as a TCP client speaking
// GridConnect ASCII frames on port 12021. This transport flips the
// WebSocketTransport model — instead of being a client, it LISTENS and
// accepts one client connection, then bridges frames in both directions
// between the TCP socket and the library's CAN RX/TX pipeline.

import net from 'node:net';
import { GridConnectParser, fromCanMsg, toCanMsg } from '../../src/openlcb/gridconnect.js';

export const TCP_STATE = Object.freeze({
    DISCONNECTED: 'disconnected',
    LISTENING:    'listening',
    CONNECTED:    'connected',
});

export class TcpGridConnectServer {
    /**
     * @param {Object} opts
     * @param {number} opts.port                   required — TCP port to listen on
     * @param {string} [opts.host='127.0.0.1']
     * @param {(canMsg) => void} opts.onCanFrame   required — every parsed incoming frame
     * @param {() => void}       [opts.onConnect]  fires when the first client connects
     * @param {(reason) => void} [opts.onDisconnect]
     * @param {(err) => void}    [opts.onError]
     * @param {(direction, gcString) => void} [opts.onTrace]  protocol trace tap
     */
    constructor(opts) {
        this._port = opts.port;
        this._host = opts.host ?? '127.0.0.1';
        this._onCanFrame = opts.onCanFrame;
        this._onConnect = opts.onConnect ?? null;
        this._onDisconnect = opts.onDisconnect ?? null;
        this._onError = opts.onError ?? null;
        this._onTrace = opts.onTrace ?? null;

        this._server = null;
        this._socket = null;
        this._parser = new GridConnectParser();
        this._state = TCP_STATE.DISCONNECTED;
    }

    get state() { return this._state; }

    /** Start listening — the name matches WebSocketTransport.connect() so OpenLcbConfig's wiring works unchanged. */
    connect() {
        if (this._server) return;
        this._server = net.createServer((socket) => this._onSocket(socket));
        this._server.on('error', (err) => this._onError?.(err));
        this._server.listen(this._port, this._host, () => {
            this._state = TCP_STATE.LISTENING;
        });
    }

    /** Stop the server and close any active connection. */
    disconnect() {
        if (this._socket) {
            try { this._socket.destroy(); } catch (_) { /* ignore */ }
            this._socket = null;
        }
        if (this._server) {
            this._server.close();
            this._server = null;
        }
        this._state = TCP_STATE.DISCONNECTED;
    }

    /** Send a CAN frame as a GridConnect ASCII string (LF-terminated). */
    send(canMsg) {
        if (!this._socket || this._state !== TCP_STATE.CONNECTED) return false;
        const gc = fromCanMsg(canMsg) + '\n';
        if (this._onTrace) this._onTrace('tx', gc);
        try {
            const ok = this._socket.write(gc);
            if (!ok) {
                // write() returned false → kernel send buffer full.
                // Still queued in Node's internal buffer; this is backpressure,
                // not an error, but we surface it so we can see it during tests.
                if (!this._backpressureLogged) {
                    this._backpressureLogged = true;
                    console.log('[tcp] write backpressure (first occurrence)');
                }
            } else if (this._backpressureLogged) {
                this._backpressureLogged = false;
                console.log('[tcp] write backpressure cleared');
            }
            return true;
        } catch (err) {
            console.log(`[tcp] write error: ${err.code} ${err.message}`);
            this._onError?.(err);
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    _onSocket(socket) {
        const peer = `${socket.remoteAddress}:${socket.remotePort}`;
        // One client at a time. A second connector (e.g. a localhost port
        // scanner on the default OpenLCB port 12021) must NOT preempt the
        // established test session — that's how we silently killed
        // OlcbCheckerClone mid-run. Reject the new socket and keep the
        // existing one.
        if (this._socket) {
            console.log(`[tcp] rejecting additional connection from ${peer} (session in use)`);
            try { socket.destroy(); } catch (_) { /* ignore */ }
            return;
        }
        console.log(`[tcp] accept ${peer}`);
        this._socket = socket;
        this._parser.reset();
        socket.setEncoding('utf8');
        socket.setNoDelay(true);

        this._state = TCP_STATE.CONNECTED;
        this._onConnect?.();

        socket.on('data', (chunk) => {
            this._parser.feed(chunk, (gcString) => {
                if (this._onTrace) this._onTrace('rx', gcString);
                try {
                    const canMsg = toCanMsg(gcString);
                    this._onCanFrame(canMsg);
                } catch (err) {
                    this._onError?.(err);
                }
            });
        });

        socket.on('close', (hadErr) => {
            console.log(`[tcp] close ${peer} hadErr=${hadErr} isCurrent=${this._socket === socket}`);
            if (this._socket === socket) {
                this._socket = null;
                this._state = this._server ? TCP_STATE.LISTENING : TCP_STATE.DISCONNECTED;
                this._onDisconnect?.('close');
            }
        });

        socket.on('error', (err) => {
            console.log(`[tcp] socket error on ${peer}: ${err.code} ${err.message}`);
        });

        socket.on('error', (err) => this._onError?.(err));
    }
}

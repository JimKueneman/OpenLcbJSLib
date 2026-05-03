// OpenLcb — the runtime.  Owns the loaded WASM instance, the transport,
// and the per-node map.  Consumers get here via the static async factory:
//
//     const openlcb = await OpenLcb.create({ transport, callbacks });
//     const node = openlcb.createNode(0x050101010700n, params, nodeCallbacks);
//     await openlcb.start();
//     await node.loginComplete;

import OpenLcbCoreFactory from '../../wasm/openlcb-core.mjs';
import { OpenLcbNode } from './node.js';
import { buildAndCreateNode } from './internals/params.js';
import { createApi, createHooks } from './internals/wasm-api.js';
import {
    WasmLoadError,
    TransportConnectError,
    errorForReturnCode,
} from './errors.js';

const FRAME_TERMINATOR = '\n';

// ---------------------------------------------------------------------------
// Codec namespaces — pure functions, need WASM loaded.  Built once per
// runtime, attached as openlcb.float16, openlcb.broadcastTime, etc.
// ---------------------------------------------------------------------------

function buildCodecNamespaces(api, Module) {
    return {
        float16: Object.freeze({
            fromFloat:          (v)        => api.f16FromFloat(+v),
            toFloat:            (half)     => api.f16ToFloat(half | 0),
            negate:             (half)     => api.f16Negate(half | 0),
            isNaN:              (half)     => api.f16IsNaN(half | 0) === 1,
            isZero:             (half)     => api.f16IsZero(half | 0) === 1,
            speedWithDirection: (mps, rev) => api.f16SpeedWithDirection(+mps, rev ? 1 : 0),
            getSpeed:           (half)     => api.f16GetSpeed(half | 0),
            getDirection:       (half)     => api.f16GetDirection(half | 0) === 1,
        }),

        broadcastTime: Object.freeze({
            makeClockId:         (unique48)   => api.btMakeClockId(BigInt(unique48)),
            isTimeEvent:         (eid)        => api.btIsTimeEvent(BigInt(eid)) === 1,
            extractClockId:      (eid)        => api.btExtractClockId(BigInt(eid)),
            getEventType:        (eid)        => api.btGetEventType(BigInt(eid)),
            extractTime: (eid) => {
                const r = api.btExtractTime(BigInt(eid));
                return r < 0 ? null : { hour: (r >> 8) & 0xFF, minute: r & 0xFF };
            },
            extractDate: (eid) => {
                const r = api.btExtractDate(BigInt(eid));
                return r < 0 ? null : { month: (r >> 8) & 0xFF, day: r & 0xFF };
            },
            extractYear: (eid) => {
                const r = api.btExtractYear(BigInt(eid));
                return r < 0 ? null : r;
            },
            extractRate: (eid) => {
                // Needs a heap slot for the signed int16 out-param.  Read it
                // back via DataView over HEAPU8.buffer because this WASM build
                // only exports HEAPU8 (no HEAP16/HEAP32 typed views).
                const ptr = api.malloc(2);
                try {
                    const ok = api.btExtractRate(BigInt(eid), ptr);
                    if (ok !== 1) return null;
                    return new DataView(Module.HEAPU8.buffer, ptr, 2).getInt16(0, true);
                } finally {
                    api.free(ptr);
                }
            },
            createTimeEventId:    (clockId, h, m, isSet) => api.btCreateTimeEvent(BigInt(clockId), h | 0, m | 0, isSet ? 1 : 0),
            createDateEventId:    (clockId, mo, d, isSet) => api.btCreateDateEvent(BigInt(clockId), mo | 0, d | 0, isSet ? 1 : 0),
            createYearEventId:    (clockId, year, isSet) => api.btCreateYearEvent(BigInt(clockId), year | 0, isSet ? 1 : 0),
            createRateEventId:    (clockId, rate, isSet) => api.btCreateRateEvent(BigInt(clockId), rate | 0, isSet ? 1 : 0),
            createCommandEventId: (clockId, cmdEnum)     => api.btCreateCommandEvent(BigInt(clockId), cmdEnum | 0),
        }),

        dccDetector: Object.freeze({
            encodeEventId:      (detectorId, dir, raw14) => api.dccEncode(BigInt(detectorId), dir | 0, raw14 | 0),
            makeShortAddress:   (shortAddr)  => api.dccShort(shortAddr | 0),
            makeConsistAddress: (consistAddr)=> api.dccConsist(consistAddr | 0),
            extractDirection:   (eid)        => api.dccExtractDir(BigInt(eid)),
            extractAddressType: (eid)        => api.dccExtractType(BigInt(eid)),
            extractRawAddress:  (eid)        => api.dccExtractRaw(BigInt(eid)),
            extractDccAddress:  (eid)        => api.dccExtractAddr(BigInt(eid)),
            extractDetectorId:  (eid)        => api.dccExtractDetector(BigInt(eid)),
            isTrackEmpty:       (eid)        => api.dccIsEmpty(BigInt(eid)) === 1,
        }),

        trainSearch: Object.freeze({
            isSearchEvent:     (eid)   => api.tsIsSearchEvent(BigInt(eid)) === 1,
            extractFlags:      (eid)   => api.tsExtractFlags(BigInt(eid)),
            createEventId:     (addr, flags) => api.tsCreateEventId(addr >>> 0, flags | 0),
            extractDigits: (eid) => {
                const ptr = api.malloc(6);
                try {
                    api.tsExtractDigits(BigInt(eid), ptr);
                    return new Uint8Array(Module.HEAPU8.subarray(ptr, ptr + 6));
                } finally {
                    api.free(ptr);
                }
            },
            digitsToAddress: (digits) => {
                const ptr = api.malloc(6);
                try {
                    Module.HEAPU8.set(digits, ptr);
                    return api.tsDigitsToAddress(ptr);
                } finally {
                    api.free(ptr);
                }
            },
        }),

        util: Object.freeze({
            generateEventRangeId: (baseId, countEnum) => api.generateEventRangeId(BigInt(baseId), countEnum | 0),
            // CAN alias for a known node ID.  Returns 0 if unknown (no AMD
            // seen yet, or local login incomplete).
            aliasForNodeId: (nodeId) => api.aliasForNodeId(BigInt(nodeId)),
        }),
    };
}

// ---------------------------------------------------------------------------
// SNIP reply extractor — turns the C-side msg_ptr into a JS object.
//
// The pointer is only valid for the duration of the on_snip_reply callback,
// so the runtime calls this synchronously inside the dispatcher before
// invoking any user-level handler.  Strings are read out of HEAPU8 as
// NUL-terminated UTF-8.  Manufacturer/user version IDs are 1-byte values
// returned as ints (or null when the C extractor reports failure).
// ---------------------------------------------------------------------------

const SNIP_BUF_MAX = 64;   // matches the largest USER_DEFINED_*_LEN in CLib

function _extractSnip(api, Module, msgPtr) {
    const buf = api.malloc(SNIP_BUF_MAX);
    const readString = (extractFn) => {
        if (!buf) return '';
        const written = extractFn(msgPtr, buf, SNIP_BUF_MAX) | 0;
        if (written <= 0) return '';
        // Strip the trailing NUL the C side includes in its byte count.
        const end = Math.min(written, SNIP_BUF_MAX);
        const slice = Module.HEAPU8.subarray(buf, buf + end);
        // Trim at first 0 byte regardless of the count, in case the C side
        // returns a length that includes terminator(s) we don't want.
        let nulAt = slice.indexOf(0);
        if (nulAt < 0) nulAt = slice.length;
        return new TextDecoder('utf-8').decode(slice.subarray(0, nulAt));
    };
    const readByte = (extractFn) => {
        const v = extractFn(msgPtr) | 0;
        return v < 0 ? null : v;
    };
    try {
        return {
            manufacturerVersionId: readByte(api.snipExtractMfgVer),
            userVersionId:         readByte(api.snipExtractUserVer),
            manufacturerName:      readString(api.snipExtractName),
            model:                 readString(api.snipExtractModel),
            hardwareVersion:       readString(api.snipExtractHwVer),
            softwareVersion:       readString(api.snipExtractSwVer),
            userName:              readString(api.snipExtractUserName),
            userDescription:       readString(api.snipExtractUserDesc),
        };
    } finally {
        if (buf) api.free(buf);
    }
}

// ---------------------------------------------------------------------------
// OpenLcb
// ---------------------------------------------------------------------------

export class OpenLcb {
    /** @internal — use OpenLcb.create(). */
    constructor() {
        /** @type {Map<bigint, OpenLcbNode>} */
        this._nodes = new Map();
        this._pendingNodes = [];

        this._Module = null;
        this._api = null;

        this._transport = null;
        this._callbacks = null;

        this._running = false;
        this._runInterval = null;
        this._tickInterval = null;

        // Codec namespaces — set after WASM loads.
        this.float16 = null;
        this.broadcastTime = null;
        this.dccDetector = null;
        this.trainSearch = null;
        this.util = null;
    }

    /**
     * Async factory — loads WASM, wires the transport, installs callback
     * hooks, and runs wasm_initialize().  Returns a fully-initialized
     * runtime; nodes can be created immediately via createNode(), but no
     * transport traffic flows until start() is called.
     *
     * @param {object} opts
     * @param {object} opts.transport   Transport with connect/disconnect/send + onMessage/onError/onStateChange
     * @param {object} [opts.callbacks] Runtime-level callbacks: onTransportConnect/Disconnect/Error, on100msTimer,
     *                                  onBroadcastTimeChanged, onTrainSearchNoMatch, onTrainSearchReply,
     *                                  onVerifiedNodeId, onSimpleNodeInfoReply, onStream*
     * @returns {Promise<OpenLcb>}
     */
    static async create(opts) {
        if (!opts) throw new Error('OpenLcb.create: opts required');
        if (!opts.transport) throw new Error('OpenLcb.create: opts.transport required');

        const self = new OpenLcb();
        self._transport = opts.transport;
        self._callbacks = opts.callbacks ?? {};

        // Dispatcher bridges WASM hooks into per-node callback invocation.
        const dispatcher = {
            nodeOf: (nid) => self._nodes.get(BigInt(nid)) ?? null,
            onGridconnectTx: (frame) => self._onGridconnectTx(frame),
            on100msTimer:    ()      => self._callbacks.on100msTimer?.(),
            onLoginComplete: (nid)   => {
                const n = self._nodes.get(BigInt(nid));
                if (!n) return;
                n._resolveLoginComplete();
                n._callbacks.onLoginComplete?.(n);
            },
            onBroadcastTimeChanged: (clockId, h, m) =>
                self._callbacks.onBroadcastTimeChanged?.(clockId, h, m),
            // Train-search no-match with Allocate flag: JS may create a new
            // train node and return its BigInt ID (or null to decline).
            // Routes to opts.callbacks.onTrainSearchNoMatch(searchEventId).
            onTrainSearchNoMatch: (searchEventId) => {
                const cb = self._callbacks.onTrainSearchNoMatch;
                if (!cb) return null;
                const result = cb(searchEventId);
                if (typeof result === 'bigint') return result;
                if (result && typeof result.id === 'bigint') return result.id; // allow returning an OpenLcbNode
                return null;
            },
            // Throttle-side: a remote train replied to a search this device
            // sent.  Carries source 48-bit ID + 12-bit alias.  Routes to
            // opts.callbacks.onTrainSearchReply(sourceId, sourceAlias, searchEventId).
            onTrainSearchReply: (sourceId, sourceAlias, searchEventId) => {
                self._callbacks.onTrainSearchReply?.(sourceId, sourceAlias, searchEventId);
            },
            // Verified Node ID reply — fires once per remote replier in
            // response to a Verify Node ID we sent (addressed or global).
            // Carries the receiving node + the source's resolved (id, alias).
            onVerifiedNodeId: (receivingNodeId, sourceId, sourceAlias) => {
                const node = self._nodes.get(BigInt(receivingNodeId));
                self._callbacks.onVerifiedNodeId?.(node ?? null, sourceId, sourceAlias);
            },
            // Simple Node Info reply — fires when a remote node answers a
            // request issued via OpenLcbNode#sendSimpleNodeInfoRequest.  The
            // raw msgPtr is only valid during this hook, so we fully extract
            // the payload before invoking the user's callback.  Routes to
            // opts.callbacks.onSimpleNodeInfoReply(sourceId, sourceAlias, fields).
            onSnipReply: (sourceId, sourceAlias, msgPtr) => {
                const cb = self._callbacks.onSimpleNodeInfoReply;
                if (!cb) return;
                cb(sourceId, sourceAlias, _extractSnip(self._api, self._Module, msgPtr));
            },
            onStreamInitiateRequest: (ptr) => self._callbacks.onStreamInitiateRequest?.(ptr) ?? false,
            onStreamInitiateReply:   (ptr) => self._callbacks.onStreamInitiateReply?.(ptr),
            onStreamDataReceived:    (ptr) => self._callbacks.onStreamDataReceived?.(ptr),
            onStreamDataProceed:     (ptr) => self._callbacks.onStreamDataProceed?.(ptr),
            onStreamComplete:        (ptr) => self._callbacks.onStreamComplete?.(ptr),
            onConfigMemRead:  (nid, addr, count, ptr) => self._onConfigMemRead(nid, addr, count, ptr),
            onConfigMemWrite: (nid, addr, count, ptr) => self._onConfigMemWrite(nid, addr, count, ptr),
        };

        // Save dispatcher so reboot() can re-register the same hooks on a
        // fresh Module instance without rebuilding the closure.
        self._dispatcher = dispatcher;

        let Module;
        try {
            Module = await OpenLcbCoreFactory(createHooks(dispatcher));
        } catch (e) {
            throw new WasmLoadError('WASM factory failed', { cause: e });
        }
        self._Module = Module;
        self._api = createApi(Module);
        self._api.initialize();

        // Bind transport handlers (runtime owns these — user never touches).
        // The pump's lifecycle is tied to transport state: only run wasm_run
        // (which emits frames) while the socket is actually open.  This
        // avoids racing the pump against the WebSocket handshake, and makes
        // auto-reconnect work cleanly — the pump halts on disconnect and
        // restarts when the new connection comes up.
        self._transport.onMessage    = (chunk) => self._onTransportData(chunk);
        self._transport.onError      = (err)   => self._callbacks.onTransportError?.(err);
        self._transport.onStateChange = (state) => {
            if (state === 'connected') {
                self._startPump();
                self._callbacks.onTransportConnect?.();
            } else if (state === 'disconnected') {
                self._stopPump();
                self._callbacks.onTransportDisconnect?.();
            }
        };

        // Attach codec namespaces.
        Object.assign(self, buildCodecNamespaces(self._api, Module));

        // Materialize any nodes queued before the factory resolved.  (Edge
        // case — createNode can be called after create() but during
        // async chain; normally this list is empty.)
        for (const { id, params, callbacks } of self._pendingNodes) {
            self._materializeNode(id, params, callbacks);
        }
        self._pendingNodes.length = 0;

        return self;
    }

    /**
     * Allocate a new OpenLCB node.  Returns a handle immediately; login
     * runs in the background once the transport is open.
     *
     * @param {bigint | number} nodeId   48-bit OpenLCB node ID
     * @param {object}   parameters      SNIP, protocolSupport, address spaces, ...
     * @param {object}   [callbacks]     Per-node callback bag
     * @returns {OpenLcbNode}
     */
    createNode(nodeId, parameters, callbacks) {
        const id = BigInt(nodeId);
        const node = new OpenLcbNode(id, parameters, callbacks ?? {});
        this._nodes.set(id, node);

        if (this._api) {
            this._materializeNode(id, parameters, callbacks);
            node._bindApi(this._api);
        } else {
            this._pendingNodes.push({ id, params: parameters, callbacks });
        }
        return node;
    }

    _materializeNode(id, params, _callbacks) {
        buildAndCreateNode(this._api, id, params);
        const node = this._nodes.get(id);
        if (node) node._bindApi(this._api);
    }

    /**
     * Open the transport and start pumping the state machine.  Resolves
     * when the transport is connected.  Rejects (TransportConnectError)
     * if the transport fails to open.
     */
    async start() {
        if (this._running) return;
        this._running = true;
        try {
            await Promise.resolve(this._transport.connect());
        } catch (e) {
            this._running = false;
            this._stopPump();   // safety — onStateChange may have started it
            throw new TransportConnectError('transport.connect() failed', { cause: e });
        }
        // Pump starts automatically via onStateChange('connected').
    }

    /**
     * Close the transport and stop the pump.  Node handles remain valid
     * but dormant until start() is called again.
     */
    async stop() {
        this._running = false;
        this._stopPump();
        await Promise.resolve(this._transport.disconnect());
    }

    /**
     * Soft-reboot the OpenLCB stack: discard the WASM module, instantiate
     * a fresh one, and replay every previously-created node onto it.  The
     * transport is NOT touched — the existing connection (e.g. WebSocket
     * to JMRI) stays open across the reboot.  Node handle objects survive;
     * each one's loginComplete promise is replaced so callers can `await`
     * the post-reboot login.
     *
     * Use this from `onReboot` / `onFactoryReset` callbacks to honor a
     * Memory Configuration Reset/Reboot or Factory Reset datagram with
     * spec-correct "fresh node, same medium" semantics.
     */
    async reboot() {
        if (!this._dispatcher) throw new Error('reboot() before create() resolved');

        // Halt the pump but leave the transport alone.
        this._stopPump();

        // Snapshot existing node specs so we can replay them on the new module.
        const specs = [];
        for (const node of this._nodes.values()) {
            specs.push({ node, params: node.parameters, callbacks: node._callbacks });
        }

        // Drop refs so GC can reclaim the WASM heap.
        this._Module = null;
        this._api = null;

        // Bring up a fresh Module instance with the same dispatcher.
        let Module;
        try {
            Module = await OpenLcbCoreFactory(createHooks(this._dispatcher));
        } catch (e) {
            throw new WasmLoadError('WASM factory failed during reboot', { cause: e });
        }
        this._Module = Module;
        this._api = createApi(Module);
        this._api.initialize();

        // Refresh codec namespaces — they wrap the new api/Module.
        Object.assign(this, buildCodecNamespaces(this._api, Module));

        // Re-materialize each node on the new WASM, reusing the same
        // OpenLcbNode handle objects so the application's references stay valid.
        for (const { node, params, callbacks } of specs) {
            node._resetForReboot();
            this._materializeNode(node.id, params, callbacks);
            node._bindApi(this._api);
        }

        // Resume the pump if the transport is still up.
        this._startPump();
    }

    // ------------------------------------------------------------------------
    // Pump — drains WASM state machine under a time budget per slice.
    // Only runs while the runtime is marked running AND WASM is ready.
    // ------------------------------------------------------------------------

    _startPump() {
        if (!this._running || !this._api || this._runInterval) return;
        const DRAIN_BUDGET_MS = 5;
        const now = (typeof performance !== 'undefined' && performance.now)
            ? () => performance.now()
            : () => Date.now();
        this._runInterval = setInterval(() => {
            const deadline = now() + DRAIN_BUDGET_MS;
            do { this._api.run(); } while (now() < deadline);
        }, 5);
        this._tickInterval = setInterval(() => this._api.tick(), 100);
    }

    _stopPump() {
        if (this._runInterval)  { clearInterval(this._runInterval);  this._runInterval = null; }
        if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
    }

    // ------------------------------------------------------------------------
    // Transport ⇄ WASM glue
    // ------------------------------------------------------------------------

    _onTransportData(chunk) {
        if (!this._api) return;
        let text;
        if (typeof chunk === 'string')               text = chunk;
        else if (chunk instanceof ArrayBuffer)       text = new TextDecoder().decode(new Uint8Array(chunk));
        else if (chunk instanceof Uint8Array)        text = new TextDecoder().decode(chunk);
        else return;
        this._api.rx(text);
    }

    _onGridconnectTx(frame) {
        this._transport.send(frame + FRAME_TERMINATOR);
    }

    // ------------------------------------------------------------------------
    // Config memory dispatch — per-node callbacks in the node's callback bag.
    // ------------------------------------------------------------------------

    _onConfigMemRead(nid, addr, count, heapPtr) {
        const node = this._nodes.get(BigInt(nid));
        if (!node) return 0;
        const fn = node._callbacks.onConfigMemRead;
        if (!fn) return 0;
        const n = Number(count);
        const buf = new Uint8Array(n);
        const written = fn(node, Number(addr), n, buf) | 0;
        if (written > 0) this._Module.HEAPU8.set(buf.subarray(0, written), heapPtr);
        return written;
    }

    _onConfigMemWrite(nid, addr, count, heapPtr) {
        const node = this._nodes.get(BigInt(nid));
        if (!node) return 0;
        const fn = node._callbacks.onConfigMemWrite;
        const n = Number(count);
        const bytes = this._Module.HEAPU8.subarray(heapPtr, heapPtr + n);
        if (!fn) return n; // default: accept
        return fn(node, Number(addr), n, bytes) | 0;
    }
}

// Ported from OpenLcbCLib/src/openlcb/openlcb_node.[hc].
//
// Pool of virtual OpenLCB nodes with multi-key enumeration and lookup by
// alias / Node ID. The C implementation uses a fixed-size static array
// because buffers are statically allocated; the JS port uses a plain array
// and grows on allocate() — there is no pool limit.

import { createNode } from './types.js';
import {
    RUNSTATE_INIT,
    MAX_NODE_ENUM_KEY_VALUES,
    NULL_EVENT_ID,
} from './defines.js';

/** Matches the C OPENLCB_EVENT_ID_OFFSET — 48-bit Node ID → 64-bit event ID base. */
const EVENT_ID_OFFSET_BITS = 16n;

export class NodePool {
    /**
     * @param {Object} [opts]
     * @param {() => void} [opts.on100msTimerTick] optional application-level tick hook
     */
    constructor({ on100msTimerTick = null } = {}) {
        this._nodes = [];
        this._enumIndex = new Array(MAX_NODE_ENUM_KEY_VALUES).fill(0);
        this._on100msTimerTick = on100msTimerTick;
        this._lastTick = 0;
    }

    initialize() {
        this._nodes.length = 0;
        this._enumIndex.fill(0);
        this._lastTick = 0;
    }

    /**
     * Allocate a new node. Auto-creates consumer/producer events per
     * `parameters.consumerCountAutocreate` / `producerCountAutocreate`,
     * starting from `nodeId << 16`. Returns the node.
     *
     * @param {bigint} nodeId
     * @param {Object} nodeParameters
     * @returns {Object} node
     */
    allocate(nodeId, nodeParameters) {
        const node = createNode(nodeId, nodeParameters);
        node.index = this._nodes.length;
        node.state.allocated = true;
        node.state.runState = RUNSTATE_INIT;
        node.seed = nodeId;
        this._generateEventIds(node);
        this._nodes.push(node);
        return node;
    }

    _generateEventIds(node) {
        const base = BigInt.asUintN(64, node.id) << EVENT_ID_OFFSET_BITS;
        const params = node.parameters ?? {};
        const consumerCount = params.consumerCountAutocreate ?? 0;
        const producerCount = params.producerCountAutocreate ?? 0;

        node.consumers.list = [];
        for (let i = 0; i < consumerCount; i++) {
            node.consumers.list.push({ event: base + BigInt(i), status: 0 });
        }
        node.consumers.count = consumerCount;
        node.consumers.rangeList = node.consumers.rangeList ?? [];
        node.consumers.rangeCount = node.consumers.rangeList.length;
        node.consumers.enumerator = { running: false, enumIndex: 0, rangeEnumIndex: 0 };

        node.producers.list = [];
        for (let i = 0; i < producerCount; i++) {
            node.producers.list.push({ event: base + BigInt(i), status: 0 });
        }
        node.producers.count = producerCount;
        node.producers.rangeList = node.producers.rangeList ?? [];
        node.producers.rangeCount = node.producers.rangeList.length;
        node.producers.enumerator = { running: false, enumIndex: 0, rangeEnumIndex: 0 };
    }

    // -------------------------------------------------------------------------
    // Enumeration — independent cursors keyed by 0..MAX_NODE_ENUM_KEY_VALUES-1
    // -------------------------------------------------------------------------

    getFirst(key) {
        if (key >= MAX_NODE_ENUM_KEY_VALUES) return null;
        this._enumIndex[key] = 0;
        return this._nodes[0] ?? null;
    }

    getNext(key) {
        if (key >= MAX_NODE_ENUM_KEY_VALUES) return null;
        const idx = ++this._enumIndex[key];
        return idx < this._nodes.length ? this._nodes[idx] : null;
    }

    isLast(key) {
        if (key >= MAX_NODE_ENUM_KEY_VALUES) return false;
        if (this._nodes.length === 0) return false;
        return this._enumIndex[key] >= this._nodes.length - 1;
    }

    // -------------------------------------------------------------------------
    // Lookup
    // -------------------------------------------------------------------------

    findByAlias(alias) {
        for (const n of this._nodes) {
            if (n.alias === alias) return n;
        }
        return null;
    }

    findByNodeId(nodeId) {
        for (const n of this._nodes) {
            if (n.id === nodeId) return n;
        }
        return null;
    }

    getCount() {
        return this._nodes.length;
    }

    /** Underlying array — kept for callers that need to iterate. Do not mutate. */
    getAllNodes() {
        return this._nodes;
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /** Reset every node to pre-login state without deallocating. */
    resetState() {
        for (const n of this._nodes) {
            n.state.runState = RUNSTATE_INIT;
            n.state.permitted = false;
            n.state.initialized = false;
        }
    }

    /**
     * Fires the optional application callback at most once per unique tick
     * value. The per-node `timerticks` field is no longer incremented — the
     * main loop uses elapsed-time subtraction against the global tick.
     */
    timerTick(currentTick) {
        if (((currentTick - this._lastTick) & 0xFF) === 0) return;
        this._lastTick = currentTick & 0xFF;
        if (this._on100msTimerTick) this._on100msTimerTick();
    }
}

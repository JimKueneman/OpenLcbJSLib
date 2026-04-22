// Ported from OpenLcbCLib/src/drivers/canbus/alias_mapping_listener.[hc].
//
// Tracks Node ID → alias resolution for consist listener nodes. Unlike the
// primary alias table, entries here are created when a listener is ATTACHED
// and populated later when the matching AMD arrives. The round-robin
// verification prober periodically re-queries aliases with targeted AMEs so
// stale entries don't accumulate.

import { createListenerAliasEntry } from './types.js';

export class AliasMappingListener {
    /**
     * @param {Object} opts
     * @param {number} [opts.capacity=16] table depth
     * @param {number} [opts.probeTickInterval=10]   rate-limit (100ms ticks) between prober calls
     * @param {number} [opts.probeIntervalTicks=600] age (prober ticks) before a resolved alias is re-probed
     * @param {number} [opts.verifyTimeoutTicks=30]  AME reply window before the alias is declared stale
     */
    constructor({
        capacity = 16,
        probeTickInterval = 10,
        probeIntervalTicks = 600,
        verifyTimeoutTicks = 30,
    } = {}) {
        this._capacity = capacity;
        this._probeTickInterval = probeTickInterval;
        this._probeIntervalTicks = probeIntervalTicks;
        this._verifyTimeoutTicks = verifyTimeoutTicks;
        this._table = [];
        for (let i = 0; i < capacity; i++) {
            this._table.push(createListenerAliasEntry());
        }
        this._verifyCursor = 0;
        this._verifyLastTick = 0;
        this._verifyCounter = 0;
    }

    initialize() {
        for (const e of this._table) {
            e.nodeId = 0n;
            e.alias = 0;
            e.verifyTicks = 0;
            e.verifyPending = false;
        }
        this._verifyCursor = 0;
        this._verifyLastTick = 0;
        this._verifyCounter = 0;
    }

    /**
     * Register a listener Node ID with alias = 0. If nodeId already exists,
     * returns the existing entry unchanged. Returns null if table full or
     * nodeId is 0.
     */
    register(nodeId) {
        if (nodeId === 0n) return null;

        for (const e of this._table) {
            if (e.nodeId === nodeId) return e;
        }
        for (const e of this._table) {
            if (e.nodeId === 0n) {
                e.nodeId = nodeId;
                e.alias = 0;
                e.verifyTicks = 0;
                e.verifyPending = false;
                return e;
            }
        }
        return null;
    }

    unregister(nodeId) {
        if (nodeId === 0n) return;

        for (const e of this._table) {
            if (e.nodeId === nodeId) {
                e.nodeId = 0n;
                e.alias = 0;
                e.verifyTicks = 0;
                e.verifyPending = false;
                return;
            }
        }
    }

    /**
     * Store a resolved alias for a registered Node ID. No-op if the nodeId
     * isn't in the table (i.e. this AMD isn't from one of our listeners) or
     * if the alias is out of range.
     */
    setAlias(nodeId, alias) {
        if (alias === 0 || alias > 0xFFF) return;
        if (nodeId === 0n) return;

        for (const e of this._table) {
            if (e.nodeId === nodeId) {
                e.alias = alias;
                e.verifyTicks = this._verifyCounter;
                e.verifyPending = false;
                return;
            }
        }
    }

    findByNodeId(nodeId) {
        if (nodeId === 0n) return null;
        for (const e of this._table) {
            if (e.nodeId === nodeId) return e;
        }
        return null;
    }

    /** Clear every alias but keep nodeIds (response to a global AME). */
    flushAliases() {
        for (const e of this._table) {
            e.alias = 0;
            e.verifyPending = false;
        }
    }

    /** Clear a single entry by its current alias (response to AMR). */
    clearAliasByAlias(alias) {
        if (alias === 0) return;
        for (const e of this._table) {
            if (e.alias === alias) {
                e.alias = 0;
                e.verifyPending = false;
                return;
            }
        }
    }

    /**
     * Round-robin probe one listener entry. Returns the Node ID whose alias
     * should be verified (caller sends a targeted AME), or 0n if nothing to
     * do this tick. Rate-limited to once per probeTickInterval; at most one
     * entry per call.
     */
    checkOneVerification(currentTick) {
        const elapsed = (currentTick - this._verifyLastTick) & 0xFF;
        if (elapsed < this._probeTickInterval) return 0n;

        this._verifyLastTick = currentTick & 0xFF;
        this._verifyCounter = (this._verifyCounter + 1) & 0xFFFF;

        for (let scanned = 0; scanned < this._capacity; scanned++) {
            this._verifyCursor = (this._verifyCursor + 1) % this._capacity;
            const entry = this._table[this._verifyCursor];

            if (entry.nodeId === 0n) continue;
            if (entry.alias === 0 && !entry.verifyPending) continue;

            if (entry.verifyPending) {
                const age = (this._verifyCounter - entry.verifyTicks) & 0xFFFF;
                if (age >= this._verifyTimeoutTicks) {
                    entry.alias = 0;
                    entry.verifyPending = false;
                }
                continue;
            }

            const age = (this._verifyCounter - entry.verifyTicks) & 0xFFFF;
            if (age >= this._probeIntervalTicks) {
                entry.verifyPending = true;
                entry.verifyTicks = this._verifyCounter;
                return entry.nodeId;
            }
        }

        return 0n;
    }
}

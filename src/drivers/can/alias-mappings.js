// Ported from OpenLcbCLib/src/drivers/canbus/alias_mappings.[hc].
//
// Bidirectional lookup between 48-bit Node IDs (BigInt) and 12-bit CAN
// aliases (Number). The C version uses a fixed-size static buffer because
// memory is static; JS uses a plain Array that grows as entries are added
// (first-fit into cleared slots to preserve the "alias slot recycling"
// behaviour C relies on during alias reallocation).

import { createAliasMapping } from './types.js';

const MAX_NODE_ID = 0xFFFFFFFFFFFFn;

export class AliasMappings {
    constructor(capacity = 16) {
        this._capacity = capacity;
        this._list = [];
        for (let i = 0; i < capacity; i++) {
            this._list.push(createAliasMapping());
        }
        this.hasDuplicateAlias = false;
    }

    initialize() {
        this.flush();
    }

    flush() {
        for (const e of this._list) {
            e.nodeId = 0n;
            e.alias = 0;
            e.isDuplicate = false;
            e.isPermitted = false;
        }
        this.hasDuplicateAlias = false;
    }

    /** Pointer-equivalent: caller may read/write flags directly. */
    getList() {
        return this._list;
    }

    /** Kept for C API parity; prefer `getList()` + `hasDuplicateAlias`. */
    getAliasMappingInfo() {
        return { list: this._list, hasDuplicateAlias: this.hasDuplicateAlias };
    }

    setHasDuplicateAliasFlag() {
        this.hasDuplicateAlias = true;
    }

    clearHasDuplicateAliasFlag() {
        this.hasDuplicateAlias = false;
    }

    /**
     * Register or refresh an (alias, nodeId) pair. Reuses the existing slot if
     * nodeId is already present (correct conflict-recovery behaviour), else
     * takes the first empty slot. Returns the entry, or null on invalid input
     * / table full.
     */
    register(alias, nodeId) {
        if (alias === 0 || alias > 0xFFF) return null;
        if (nodeId === 0n || nodeId > MAX_NODE_ID) return null;

        for (const e of this._list) {
            if (e.alias === 0 || e.nodeId === nodeId) {
                e.alias = alias;
                e.nodeId = nodeId;
                return e;
            }
        }
        return null;
    }

    /** Remove the entry with the given alias. Safe to call on non-existent aliases. */
    unregister(alias) {
        for (const e of this._list) {
            if (e.alias === alias) {
                e.alias = 0;
                e.nodeId = 0n;
                e.isDuplicate = false;
                e.isPermitted = false;
                return;
            }
        }
    }

    findMappingByAlias(alias) {
        if (alias === 0 || alias > 0xFFF) return null;
        for (const e of this._list) {
            if (e.alias === alias) return e;
        }
        return null;
    }

    findMappingByNodeId(nodeId) {
        if (nodeId === 0n || nodeId > MAX_NODE_ID) return null;
        for (const e of this._list) {
            if (e.nodeId === nodeId) return e;
        }
        return null;
    }
}

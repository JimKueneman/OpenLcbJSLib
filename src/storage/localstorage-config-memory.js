// Browser-side Configuration Memory persistence backed by localStorage.
//
// Plugs into a node's createNode callbacks:
//
//   const cfgMem = new LocalStorageConfigMemory({ size: 256 });
//   openlcb.createNode(NODE_ID, params, {
//       onConfigMemRead:  cfgMem.read.bind(cfgMem),
//       onConfigMemWrite: cfgMem.write.bind(cfgMem),
//       onFactoryReset:   (n) => { cfgMem.clear(n.id); openlcb.reboot(); },
//   });
//
// Bytes for each node live under one localStorage key (NodeID-namespaced).
// Reads of never-written addresses return zero — required for tools that
// expect null-terminated strings (JMRI's SNIP user-name display, etc.).
//
// Backed by LocalStore (src/storage/local-store.js).  Application code that
// wants to persist its own data should use LocalStore directly rather than
// piggy-back on the config-memory blob.

import { LocalStore } from './local-store.js';

const DEFAULT_KEY = 'config-mem';

export class LocalStorageConfigMemory {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.size=1024]      capacity (bytes) — should match
     *                                       node's addressSpaceConfigMemory.highestAddress
     * @param {LocalStore} [opts.store]      backing KV (default: new LocalStore())
     * @param {string} [opts.keyPrefix]      forwarded to LocalStore if `store` is omitted
     * @param {Storage} [opts.storage]       forwarded to LocalStore if `store` is omitted
     * @param {string} [opts.subKey]         per-node sub-key (default: 'config-mem')
     */
    constructor(opts = {}) {
        this._size = opts.size ?? 1024;
        this._subKey = opts.subKey ?? DEFAULT_KEY;
        this._store = opts.store ?? new LocalStore({
            keyPrefix: opts.keyPrefix,
            storage:   opts.storage,
        });
    }

    /** Matches the `onConfigMemRead` callback signature. */
    read(node, address, count, buffer) {
        const bytes = this._loadOrInit(node.id);
        for (let i = 0; i < count; i++) {
            buffer[i] = bytes[address + i] ?? 0;
        }
        return count;
    }

    /** Matches the `onConfigMemWrite` callback signature. */
    write(node, address, count, buffer) {
        const bytes = this._loadOrInit(node.id);
        const need = address + count;
        const target = need > bytes.length ? this._growTo(bytes, need) : bytes;
        for (let i = 0; i < count; i++) {
            target[address + i] = buffer[i];
        }
        this._store.setBytes(node.id, this._subKey, target);
        return count;
    }

    /** Erase the stored config-memory blob for `nodeId`. */
    clear(nodeId) {
        this._store.remove(nodeId, this._subKey);
    }

    _loadOrInit(nodeId) {
        return this._store.getBytes(nodeId, this._subKey) ?? new Uint8Array(this._size);
    }

    _growTo(bytes, size) {
        const grown = new Uint8Array(size);
        grown.set(bytes);
        return grown;
    }
}

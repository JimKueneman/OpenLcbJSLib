// Browser-side Configuration Memory persistence backed by localStorage.
//
// Plugs into OpenLcbConfig:
//
//   const cfgMem = new LocalStorageConfigMemory();
//   new OpenLcbConfig({
//       websocketUrl: '...',
//       configMemoryRead:  cfgMem.read.bind(cfgMem),
//       configMemoryWrite: cfgMem.write.bind(cfgMem),
//   });
//
// One localStorage key per Node ID, contents base64-encoded. Reads return
// zeros for untouched regions. Designed for the modest config-memory sizes
// OpenLCB nodes typically use (a few KB).

export class LocalStorageConfigMemory {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.keyPrefix='openlcb-cfg:']
     * @param {number} [opts.size=1024]  capacity (bytes) allocated on first write
     * @param {Storage} [opts.storage]  override for testing (default: window.localStorage)
     */
    constructor(opts = {}) {
        this._prefix = opts.keyPrefix ?? 'openlcb-cfg:';
        this._size = opts.size ?? 1024;
        this._storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
        if (!this._storage) {
            throw new Error('LocalStorageConfigMemory: no localStorage available (pass opts.storage)');
        }
    }

    /** Matches OpenLcbConfig's `configMemoryRead` signature. */
    read(node, address, count, buffer) {
        const bytes = this._load(node.id);
        for (let i = 0; i < count; i++) {
            buffer[i] = bytes[address + i] ?? 0;
        }
        return count;
    }

    /** Matches OpenLcbConfig's `configMemoryWrite` signature. */
    write(node, address, count, buffer) {
        const bytes = this._load(node.id);
        if (address + count > bytes.length) {
            // Grow to fit the write.
            const grown = new Uint8Array(address + count);
            grown.set(bytes);
            bytes.set(bytes.subarray(0, bytes.length), 0);
            this._save(node.id, grown);
            for (let i = 0; i < count; i++) grown[address + i] = buffer[i];
            this._save(node.id, grown);
            return count;
        }
        for (let i = 0; i < count; i++) {
            bytes[address + i] = buffer[i];
        }
        this._save(node.id, bytes);
        return count;
    }

    /** Clear all stored bytes for `nodeId`. */
    clear(nodeId) {
        this._storage.removeItem(this._key(nodeId));
    }

    _key(nodeId) {
        return this._prefix + nodeId.toString(16).padStart(12, '0');
    }

    _load(nodeId) {
        const encoded = this._storage.getItem(this._key(nodeId));
        if (!encoded) return new Uint8Array(this._size);
        const raw = atob(encoded);
        const out = new Uint8Array(Math.max(this._size, raw.length));
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    _save(nodeId, bytes) {
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        this._storage.setItem(this._key(nodeId), btoa(s));
    }
}

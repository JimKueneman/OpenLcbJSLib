// Generic browser-side persistence over localStorage.
//
// Keys are namespaced by 48-bit OpenLCB Node ID so multiple nodes (e.g. two
// throttles in different tabs of the same origin) don't collide.  Bytes are
// stored base64-encoded; structured data uses JSON.
//
//   const store = new LocalStore();
//   store.setBytes(nodeId, 'config-mem', cfgBytes);
//   store.setJson (nodeId, 'last-train',  { addr: 1234, long: true });
//   store.clearNode(nodeId);   // wipe everything for that node
//
// The OpenLCB library uses this as the backing store for
// `LocalStorageConfigMemory` (see localstorage-config-memory.js).
// Application code is welcome to use it directly for its own UI / roster /
// preference data — anything that should survive a page reload.

export class LocalStore {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.keyPrefix='openlcb:']
     * @param {Storage} [opts.storage]  override for testing (default: window.localStorage)
     */
    constructor(opts = {}) {
        this._prefix = opts.keyPrefix ?? 'openlcb:';
        this._storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
        if (!this._storage) {
            throw new Error('LocalStore: no localStorage available (pass opts.storage)');
        }
    }

    /** Returns the stored bytes, or null if the key is unset. */
    getBytes(nodeId, key) {
        const encoded = this._storage.getItem(this._fullKey(nodeId, key));
        if (encoded == null) return null;
        const raw = atob(encoded);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    setBytes(nodeId, key, bytes) {
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        this._storage.setItem(this._fullKey(nodeId, key), btoa(s));
    }

    /** Returns the parsed JSON value, or null if the key is unset. */
    getJson(nodeId, key) {
        const s = this._storage.getItem(this._fullKey(nodeId, key));
        return s == null ? null : JSON.parse(s);
    }

    setJson(nodeId, key, value) {
        this._storage.setItem(this._fullKey(nodeId, key), JSON.stringify(value));
    }

    remove(nodeId, key) {
        this._storage.removeItem(this._fullKey(nodeId, key));
    }

    /** Wipes every key stored under this node ID. */
    clearNode(nodeId) {
        const prefix = this._nodePrefix(nodeId);
        const toRemove = [];
        for (let i = 0; i < this._storage.length; i++) {
            const k = this._storage.key(i);
            if (k != null && k.startsWith(prefix)) toRemove.push(k);
        }
        for (const k of toRemove) this._storage.removeItem(k);
    }

    _nodePrefix(nodeId) {
        return this._prefix + BigInt(nodeId).toString(16).padStart(12, '0') + ':';
    }

    _fullKey(nodeId, key) {
        return this._nodePrefix(nodeId) + key;
    }
}

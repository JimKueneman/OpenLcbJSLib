// Node-side Configuration Memory persistence backed by a file on disk.
//
// This is the Node-side counterpart to LocalStorageConfigMemory — same
// callback signatures, swap in where appropriate. Not shipped for browsers
// (imports node:fs). Typical wiring:
//
//   import { FileConfigMemory } from 'openlcb-js-lib/storage/file-config-memory.js';
//   const cfgMem = new FileConfigMemory({ directory: '/var/lib/openlcb' });
//   new OpenLcbConfig({
//       transport: ...,
//       configMemoryRead:  cfgMem.read.bind(cfgMem),
//       configMemoryWrite: cfgMem.write.bind(cfgMem),
//   });
//
// One `<nodeId>.bin` file per Node ID, backed by fs.readFileSync /
// writeFileSync. Reads are synchronous so they fit OpenLcbConfig's sync
// `(node, addr, count, buffer) => bytesRead` shape.

import fs from 'node:fs';
import path from 'node:path';

export class FileConfigMemory {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.directory='./.openlcb-cfg']  directory to store files in (auto-created)
     * @param {number} [opts.size=1024]                   capacity allocated on first write
     */
    constructor(opts = {}) {
        this._dir = opts.directory ?? './.openlcb-cfg';
        this._size = opts.size ?? 1024;
        fs.mkdirSync(this._dir, { recursive: true });
    }

    read(node, address, count, buffer) {
        const bytes = this._load(node.id);
        for (let i = 0; i < count; i++) {
            buffer[i] = bytes[address + i] ?? 0;
        }
        return count;
    }

    write(node, address, count, buffer) {
        let bytes = this._load(node.id);
        if (address + count > bytes.length) {
            const grown = new Uint8Array(address + count);
            grown.set(bytes);
            bytes = grown;
        }
        for (let i = 0; i < count; i++) {
            bytes[address + i] = buffer[i];
        }
        this._save(node.id, bytes);
        return count;
    }

    clear(nodeId) {
        try { fs.unlinkSync(this._path(nodeId)); } catch (_) { /* ignore ENOENT */ }
    }

    _path(nodeId) {
        return path.join(this._dir, nodeId.toString(16).padStart(12, '0') + '.bin');
    }

    _load(nodeId) {
        try {
            const buf = fs.readFileSync(this._path(nodeId));
            if (buf.length >= this._size) return new Uint8Array(buf);
            const out = new Uint8Array(this._size);
            out.set(buf);
            return out;
        } catch (e) {
            if (e.code === 'ENOENT') return new Uint8Array(this._size);
            throw e;
        }
    }

    _save(nodeId, bytes) {
        fs.writeFileSync(this._path(nodeId), bytes);
    }
}

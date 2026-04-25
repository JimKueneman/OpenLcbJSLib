#!/usr/bin/env node
//
// Coverage audit — finds gaps between the C library, the WASM bindings, and
// the JS wrapper.  Heuristic (regex-based), not a compiler pass — intended
// to flag candidates for review, not to be 100% authoritative.
//
// Three passes:
//   1. C public API → WASM exports.  Any `extern OpenLcb*_*()` decl in a
//      header that has no `wasm_*` wrapper in bindings.c is a candidate gap.
//   2. WASM callback structs → EM_ASM trampolines.  Any C function installed
//      into an `interface_openlcb_*_t` field that has no `EM_ASM` call in
//      its body is a silent stub (no JS hook).
//   3. WASM exports → JS wrapper.  Any `wasm_*` export that the wrapper
//      never references is not surfaced to consumers.
//
// Usage:
//   node tools/audit-wasm-coverage.mjs [--clib <path>]
// Default CLib path is `../OpenLcbCLib`.

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const argv = process.argv.slice(2);
const clibArg = argv.indexOf('--clib');
const CLIB = resolve(clibArg === -1 ? join(ROOT, '..', 'OpenLcbCLib') : argv[clibArg + 1]);

const CLIB_HDRS_DIR = join(CLIB, 'src', 'openlcb');
const BINDINGS_C   = join(CLIB, 'wasm', 'bindings.c');
const WRAPPER_DIR  = join(ROOT, 'src', 'openlcb');

// ---------------------------------------------------------------------------

async function listFiles(dir, pattern) {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isFile()) {
            if (pattern.test(e.name)) out.push(join(dir, e.name));
        } else if (e.isDirectory()) {
            // Recurse — the wrapper now has an internals/ subfolder.
            out.push(...await listFiles(join(dir, e.name), pattern));
        }
    }
    return out;
}

async function readAll(paths) {
    return (await Promise.all(paths.map((p) => readFile(p, 'utf8')))).join('\n');
}

// ---------------------------------------------------------------------------
// Pass 1 — C public API vs WASM exports
// ---------------------------------------------------------------------------

// Grab names from `extern ... OpenLcb<Module>_<name>(` declarations.  Matches
// across line breaks in multi-line signatures.
function extractCApiNames(hdrText) {
    const re = /\bextern\s+[\w\s\*]+?\s+(OpenLcb\w+)\s*\(/g;
    const names = new Set();
    let m;
    while ((m = re.exec(hdrText)) !== null) names.add(m[1]);
    return names;
}

// Every wasm_* symbol marked EMSCRIPTEN_KEEPALIVE, plus names defined
// via any ALL_CAPS macro expansion that takes a wasm_* symbol as its
// first arg (e.g. _TRAIN_THROTTLE_SEND, _BT_SEND_NODE_CLOCK*).
function extractWasmExports(bindingsText) {
    const names = new Set();
    const direct = /EMSCRIPTEN_KEEPALIVE\s+[\w\s\*]+?\s+(wasm_\w+)\s*\(/g;
    let m;
    while ((m = direct.exec(bindingsText)) !== null) names.add(m[1]);
    const macro = /^_[A-Z][A-Z0-9_]*\s*\(\s*(wasm_\w+)/gm;
    while ((m = macro.exec(bindingsText)) !== null) names.add(m[1]);
    return names;
}

// Style guide §1 — module-token table.  Keys are the C module prefix
// (stripped of the leading "OpenLcb"); value is the WASM module token used
// in `wasm_<token>_<action>`.  Empty string means no token (plain
// `wasm_<action>`).  Keys MUST be listed in descending length order so
// longer prefixes are tried first when matching a C API name.
const MODULE_TOKENS = [
    ['ApplicationBroadcastTime', 'bt'],
    ['ApplicationDccDetector',   'dcc'],
    ['ApplicationTrain',         'train'],
    ['Application',              ''],      // longest-match: must come last
];

// Style guide §4 — modules whose entries are intentionally out of scope
// for WASM exposure.  Any C API starting with one of these prefixes is
// skipped by pass-1.
const EXCLUDED_PREFIXES = [
    'OpenLcbBuffer',
    'OpenLcbConfig_',
    'OpenLcbFloat16_',
    'OpenLcbGridConnect_',
    'OpenLcbLoginStatemachine',
    'OpenLcbMainStatemachine',
    'OpenLcbUtilities',
    'OpenLcbNode_',           // library-internal node accessors
];

// Actions within in-scope modules that are library-internal (called from
// inside OpenLcbCLib, not by consumers).  Listed by full C name.
const EXCLUDED_CAPIS = new Set([
    // Internal ticks and init — handled by wasm_initialize/run/tick.
    'OpenLcbApplication_initialize',
    'OpenLcbApplicationTrain_initialize',
    'OpenLcbApplicationTrain_100ms_timer_tick',
    'OpenLcbApplicationBroadcastTime_initialize',
    'OpenLcbApplicationBroadcastTime_100ms_time_tick',
    'OpenLcbApplicationDccDetector_initialize',
    // Called by the library's config-memory datagram handler, not by
    // consumers.  Consumers use the onConfigMemRead/Write hooks.
    'OpenLcbApplication_read_configuration_memory',
    'OpenLcbApplication_write_configuration_memory',
    // Library-internal helpers for broadcast-time.
    'OpenLcbApplicationBroadcastTime_setup_consumer',
    'OpenLcbApplicationBroadcastTime_setup_producer',
    'OpenLcbApplicationBroadcastTime_get_clock',
    'OpenLcbApplicationBroadcastTime_make_clock_id',
    'OpenLcbApplicationBroadcastTime_trigger_query_reply',
    'OpenLcbApplicationBroadcastTime_trigger_sync_delay',
]);

// Map a C API name to the expected WASM export name per §1.  Returns null
// if the C API is out of scope for WASM exposure.
function expectedWasmName(cApi) {
    if (EXCLUDED_CAPIS.has(cApi)) return null;
    for (const prefix of EXCLUDED_PREFIXES) {
        if (cApi.startsWith(prefix)) return null;
    }
    for (const [modPrefix, token] of MODULE_TOKENS) {
        const head = 'OpenLcb' + modPrefix + '_';
        if (cApi.startsWith(head)) {
            const action = cApi.slice(head.length);
            return token ? `wasm_${token}_${action}` : `wasm_${action}`;
        }
    }
    return null;  // no module prefix matched — out of scope
}

async function passOne(hdrText, bindingsText) {
    const cApi = extractCApiNames(hdrText);
    const wasmExports = extractWasmExports(bindingsText);
    const missing = [];
    for (const api of cApi) {
        const expected = expectedWasmName(api);
        if (expected === null) continue;       // out of scope
        if (!wasmExports.has(expected)) {
            missing.push({ cApi: api, expected });
        }
    }
    return { cApi, wasmExports, missing };
}

// ---------------------------------------------------------------------------
// Pass 2 — Callback struct fields vs EM_ASM trampolines
// ---------------------------------------------------------------------------

// Find struct-initializer lines like  ".on_foo = &_my_fn,"  in bindings.c.
// For each, check whether _my_fn's body contains an EM_ASM call.
function extractCallbackBindings(bindingsText) {
    const bindings = [];
    const re = /\.(\w+)\s*=\s*&?\s*(_\w+)\s*,/g;
    let m;
    while ((m = re.exec(bindingsText)) !== null) {
        bindings.push({ field: m[1], fn: m[2] });
    }
    return bindings;
}

function fnBody(bindingsText, fnName) {
    // Find definition:  "static <type> fn_name(...)" and capture body.
    // `\b` before fnName so signatures like `static node_t *_fn_name(...)` match
    // (no whitespace between * and the identifier).
    const defRe = new RegExp(`\\bstatic\\s+[\\w\\s\\*]+?\\b${fnName}\\s*\\([^)]*\\)\\s*\\{`);
    const m = defRe.exec(bindingsText);
    if (!m) return null;
    let depth = 1, i = m.index + m[0].length;
    while (i < bindingsText.length && depth > 0) {
        const c = bindingsText[i++];
        if (c === '{') depth++;
        else if (c === '}') depth--;
    }
    return bindingsText.slice(m.index + m[0].length, i - 1);
}

async function passTwo(bindingsText) {
    const ignored = new Set([
        // Internal transport / utility fields that don't exist as Module.* hooks.
        // Add more as you encounter false positives during review.
        'transmit_raw_can_frame', 'is_tx_buffer_clear',
        'lock_shared_resources', 'unlock_shared_resources',
    ]);

    const bindings = extractCallbackBindings(bindingsText);
    const stubs = [];
    for (const b of bindings) {
        if (ignored.has(b.field)) continue;
        // Only look at on_* style callback fields — filter out initializers
        // that are not callback assignments (e.g. numeric fields).
        if (!/^on_/.test(b.field)) continue;
        const body = fnBody(bindingsText, b.fn);
        if (body == null) continue;
        if (!/EM_ASM/.test(body)) stubs.push({ field: b.field, fn: b.fn });
    }
    return stubs;
}

// ---------------------------------------------------------------------------
// Pass 4 — interface_*_t structs defined in CLib but never instantiated
// in bindings.c.
//
// Rationale: the C library has multiple parallel callback installation paths.
// `openlcb_config_t` is the big one and is wired in bindings.c.  But each
// protocol handler (train_search, broadcast_time, datagram, stream, ...)
// also has its own `interface_*_t` struct installed via a separate
// `ProtocolXxx_initialize(&interface)` call.  If bindings.c never makes that
// call, those callbacks silently never fire on the WASM build — and the
// previous passes don't catch it because they only look at structs that
// ARE initialized.
// ---------------------------------------------------------------------------

// Parse a header text for `typedef struct { ... } interface_xxx_t;` blocks.
// Returns an array of { name, callbackFields[] }.
function extractInterfaceDefs(hdrText) {
    const out = [];
    // Match the closing brace + name (must come before the body parse).
    const closeRe = /\}\s*(interface_\w+_t)\s*;/g;
    let m;
    while ((m = closeRe.exec(hdrText)) !== null) {
        const name = m[1];
        const closeIdx = m.index;
        // Walk backwards to find the matching opening brace of `typedef struct {`.
        let depth = 1, i = closeIdx - 1;
        while (i >= 0 && depth > 0) {
            const c = hdrText[i--];
            if (c === '}') depth++;
            else if (c === '{') depth--;
        }
        if (depth !== 0) continue;
        const body = hdrText.slice(i + 2, closeIdx);
        // Extract callback-shaped fields: `(*name)(...)` style.
        const fieldRe = /\(\s*\*\s*(\w+)\s*\)\s*\(/g;
        const fields = [];
        let f;
        while ((f = fieldRe.exec(body)) !== null) fields.push(f[1]);
        out.push({ name, callbackFields: fields });
    }
    return out;
}

// Check whether bindings.c references an interface type at all (variable
// declaration, pointer cast, function-arg type, etc.).
function isInterfaceUsed(bindingsText, typeName) {
    return new RegExp(`\\b${typeName}\\b`).test(bindingsText);
}

// Interface structs that are intentionally internal cross-module wiring,
// not application-facing callbacks.  These plumb library modules together
// and are installed by openlcb_config.c, not by the WASM consumer.
const INTERNAL_PLUMBING = new Set([
        'interface_openlcb_node_t',
        'interface_openlcb_login_message_handler_t',
        'interface_openlcb_login_state_machine_t',
        'interface_openlcb_main_statemachine_t',
        'interface_openlcb_protocol_event_transport_t',
        'interface_openlcb_protocol_message_network_t',
        'interface_openlcb_protocol_snip_t',
        'interface_openlcb_application_t',
        'interface_protocol_config_mem_read_handler_t',
        'interface_protocol_config_mem_write_handler_t',
        'interface_protocol_config_mem_stream_handler_t',
        'interface_protocol_config_mem_operations_handler_t',
        'interface_protocol_datagram_handler_t',
        'interface_protocol_stream_handler_t',
        'interface_openlcb_protocol_broadcast_time_handler_t',
        'interface_protocol_train_handler_t',
        // These are installed by openlcb_config.c, which forwards their
        // callbacks through fields on openlcb_config_t.on_*.  bindings.c
        // wires those config-level fields, so the WASM consumer reaches
        // them indirectly.
        'interface_openlcb_application_broadcast_time_t',
        'interface_openlcb_application_train_t',
        'interface_protocol_train_search_handler_t',
]);

async function passFour(hdrText, bindingsText) {
    const defs = extractInterfaceDefs(hdrText);
    const missing = [];
    for (const def of defs) {
        if (INTERNAL_PLUMBING.has(def.name)) continue;
        if (def.callbackFields.length === 0) continue;
        if (!isInterfaceUsed(bindingsText, def.name)) {
            missing.push(def);
        }
    }
    return missing;
}

async function passFive(hdrText, configCText, bindingsText) {
    const defs = extractInterfaceDefs(hdrText);
    const orphans = [];
    for (const def of defs) {
        if (!INTERNAL_PLUMBING.has(def.name)) continue;
        if (def.callbackFields.length === 0) continue;
        for (const field of def.callbackFields) {
            // Only check user-facing application callbacks (start with `on_`).
            // Other fields in these structs (e.g. `memory_read_space_*`,
            // `write_request_*`) are internal message-dispatch slots that
            // openlcb_config.c wires by handler-function reference, not by
            // copying user callbacks through.  Out of scope for this pass.
            if (!field.startsWith('on_')) continue;
            // Reachable if assigned anywhere in openlcb_config.c OR bindings.c.
            const rx = new RegExp(`\\.${field}\\s*=`);
            if (rx.test(configCText)) continue;
            if (rx.test(bindingsText)) continue;
            orphans.push({ iface: def.name, field });
        }
    }
    return orphans;
}

// ---------------------------------------------------------------------------
// Pass 5 — interface_*_t struct fields not forwarded from openlcb_config_t.
//
// Each "internal plumbing" interface is installed by openlcb_config.c which
// forwards individual fields like `_app_train.on_heartbeat_timeout =
// _config->on_train_heartbeat_timeout`.  If an interface has a callback
// field that is NEVER set anywhere in openlcb_config.c (and isn't installed
// directly by bindings.c), the field is unreachable from any consumer.
// This pass catches that gap.
// ---------------------------------------------------------------------------

// (passFive lives next to passFour above, sharing INTERNAL_PLUMBING.)

// ---------------------------------------------------------------------------
// Pass 3 — WASM exports vs JS wrapper
// ---------------------------------------------------------------------------

async function passThree(wasmExports) {
    const files = await listFiles(WRAPPER_DIR, /\.js$/);
    const text = await readAll(files);
    const unused = [];
    for (const ex of wasmExports) {
        // Substring match — the wrapper references exports by their wasm_*
        // name in cwrap() calls.
        if (!text.includes(ex)) unused.push(ex);
    }
    return unused;
}

// ---------------------------------------------------------------------------

// Parse audit-ignore.txt — one symbol per line, `# comment` to end-of-line.
// Blank lines and comment-only lines are ignored.  Returns a Set.
async function readIgnore() {
    const path = join(ROOT, 'tools', 'audit-ignore.txt');
    let text = '';
    try { text = await readFile(path, 'utf8'); } catch { return new Set(); }
    const out = new Set();
    for (const raw of text.split('\n')) {
        const line = raw.replace(/#.*$/, '').trim();
        if (line) out.add(line);
    }
    return out;
}

async function main() {
    // Scan both `openlcb_*.h` (public API + the openlcb_config callback
    // struct) and `protocol_*.h` (per-handler interface structs).  The
    // older glob missed protocol_*.h, which hid pass-4 findings.
    const hdrPaths = (await listFiles(CLIB_HDRS_DIR, /^(openlcb|protocol)_.*\.h$/));
    if (!hdrPaths.length) {
        console.error(`no CLib headers under ${CLIB_HDRS_DIR}`);
        process.exit(1);
    }
    const hdrText = await readAll(hdrPaths);
    const bindingsText = await readFile(BINDINGS_C, 'utf8');
    const ignore = await readIgnore();

    const configCText = await readFile(join(CLIB, 'src', 'openlcb', 'openlcb_config.c'), 'utf8');

    let { cApi, wasmExports, missing } = await passOne(hdrText, bindingsText);
    let stubs = await passTwo(bindingsText);
    let unused = await passThree(wasmExports);
    let unwiredInterfaces = await passFour(hdrText, bindingsText);
    let orphanFields = await passFive(hdrText, configCText, bindingsText);

    // Apply ignore list.
    missing = missing.filter((m) => !ignore.has(m.cApi));
    stubs   = stubs.filter((s) => !ignore.has(s.fn) && !ignore.has(s.field));
    unused  = unused.filter((n) => !ignore.has(n));
    unwiredInterfaces = unwiredInterfaces.filter((iface) => !ignore.has(iface.name));
    orphanFields = orphanFields.filter((o) => !ignore.has(o.field) && !ignore.has(`${o.iface}.${o.field}`));

    const out = [];
    out.push(`OpenLcbJSLib WASM coverage audit`);
    out.push(`  CLib:   ${CLIB}`);
    out.push(`  C API:  ${cApi.size} extern decls  |  WASM exports: ${wasmExports.size}`);
    out.push('');

    out.push(`[1] C API missing from WASM  (${missing.length})`);
    if (missing.length === 0) out.push('  (none)');
    for (const m of missing.sort((a, b) => a.cApi.localeCompare(b.cApi))) {
        out.push(`  - ${m.cApi}  (expected ${m.expected})`);
    }
    out.push('');

    out.push(`[2] Callback fields with no JS hook  (${stubs.length})`);
    if (stubs.length === 0) out.push('  (none)');
    for (const s of stubs.sort((a, b) => a.field.localeCompare(b.field))) {
        out.push(`  - .${s.field}  →  ${s.fn}`);
    }
    out.push('');

    out.push(`[3] WASM exports unused by JS wrapper  (${unused.length})`);
    if (unused.length === 0) out.push('  (none)');
    for (const name of unused.sort()) out.push(`  - ${name}`);
    out.push('');

    out.push(`[4] interface_*_t structs defined in CLib but never installed in bindings.c  (${unwiredInterfaces.length})`);
    if (unwiredInterfaces.length === 0) out.push('  (none)');
    for (const iface of unwiredInterfaces.sort((a, b) => a.name.localeCompare(b.name))) {
        out.push(`  - ${iface.name}  (${iface.callbackFields.length} callback field(s): ${iface.callbackFields.join(', ')})`);
    }
    out.push('');

    out.push(`[5] Internal-plumbing interface fields not forwarded from openlcb_config.c  (${orphanFields.length})`);
    if (orphanFields.length === 0) out.push('  (none)');
    for (const o of orphanFields.sort((a, b) => (a.iface + a.field).localeCompare(b.iface + b.field))) {
        out.push(`  - ${o.iface}.${o.field}`);
    }
    out.push('');

    out.push('Heuristic — review each entry, some may be intentional or false positives.');
    console.log(out.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });

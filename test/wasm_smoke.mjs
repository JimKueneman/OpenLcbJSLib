// Milestone 1 exit criterion: load the vendored WASM, build a node, pump
// the state machine, and confirm login completes with gridconnect frames
// emitted.
//
// Run:  node test/wasm_smoke.mjs

import factory from '../wasm/openlcb-core.mjs';

const txFrames = [];
let loginCompleteNid = null;

const Module = await factory({
    onGridconnectTx: (frame) => { txFrames.push(frame); },
    onLoginComplete: (nid)   => { loginCompleteNid = nid; },
});

const init    = Module.cwrap("wasm_initialize",                null,     []);
const reset   = Module.cwrap("wasm_node_builder_reset",        null,     []);
const setSnip = Module.cwrap("wasm_node_set_snip",             null,     ["number","string","string","string","string","number"]);
const setPS   = Module.cwrap("wasm_node_set_protocol_support", null,     ["number","number"]);
const setAuto = Module.cwrap("wasm_node_set_event_autocreate", null,     ["number","number"]);
const setSp   = Module.cwrap("wasm_node_set_address_space",    "number", ["number","number","number","number","string"]);
const create  = Module.cwrap("wasm_create_node",               "number", ["bigint"]);
const run     = Module.cwrap("wasm_run",                       null,     []);
const tick    = Module.cwrap("wasm_100ms_tick",                null,     []);
const rx      = Module.cwrap("wasm_rx_gridconnect",            null,     ["string"]);
const sendPcer = Module.cwrap("wasm_send_event_pc_report",     "number", ["bigint","bigint"]);

init();
reset();
setSnip(4, "OpenLcbJSLib", "Smoke Test", "hw0.1", "sw0.1", 2);
setPS(0x00005E00, 0);
setAuto(2, 2);
setSp(0xFF, 0x03, 0, 0,     "CDI");
setSp(0xFD, 0x01, 0, 0x1FF, "config");

const nodeId = 0x050101010707n;
const rc = create(nodeId);
if (rc !== 0) { console.error("FAIL: wasm_create_node returned", rc); process.exit(1); }

for (let i = 0; i < 200; i++) { run(); tick(); }

if (txFrames.length === 0) {
    console.error("FAIL: no gridconnect frames emitted");
    process.exit(1);
}

if (loginCompleteNid === null) {
    console.error("FAIL: onLoginComplete never fired");
    process.exit(1);
}

if (loginCompleteNid !== nodeId) {
    console.error(`FAIL: onLoginComplete got ${loginCompleteNid.toString(16)}, expected ${nodeId.toString(16)}`);
    process.exit(1);
}

console.log(`OK: ${txFrames.length} gridconnect frame(s) emitted`);
for (const f of txFrames) { console.log("  tx:", f); }
console.log(`OK: onLoginComplete fired for node ${loginCompleteNid.toString(16)}`);

const beforeCount = txFrames.length;
const pcerRc = sendPcer(nodeId, 0x0101000000000042n);
if (pcerRc !== 0) { console.error("FAIL: wasm_send_event_pc_report returned", pcerRc); process.exit(1); }
for (let i = 0; i < 20; i++) { run(); tick(); }
const pcerFrames = txFrames.slice(beforeCount).filter(f => f.includes("195B"));
if (pcerFrames.length === 0) {
    console.error("FAIL: sendPcer did not emit a PCER frame");
    process.exit(1);
}
console.log(`OK: wasm_send_event_pc_report emitted ${pcerFrames.length} PCER frame(s)`);
for (const f of pcerFrames) { console.log("  tx:", f); }

rx(":X19490001;");
run();
console.log("OK: wasm_rx_gridconnect accepted an incoming frame");

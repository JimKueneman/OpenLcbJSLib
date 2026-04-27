# Tests

Two smoke tests live here. They are runnable from a clean clone with just
`node` — no extra dependencies, no harness setup.

```
test/
├── wasm_smoke.mjs       WASM-layer sanity check (drives wasm/openlcb-core.mjs directly)
└── wrapper_smoke.mjs    Public-API sanity check (drives src/index.js against a mock transport)
```

## wasm_smoke.mjs

Loads the vendored WASM module, builds one node via the raw `wasm_*`
exports, pumps the state machine, and asserts that login completes with
GridConnect frames emitted. Also exercises `wasm_send_event_pc_report`
and `wasm_rx_gridconnect`.

Use this when changing anything in `wasm/`, `tools/wasm_update_wizard/`,
or in the OpenLcbCLib WASM build itself — it isolates the WASM ABI from
the JS wrapper.

```bash
node test/wasm_smoke.mjs
```

## wrapper_smoke.mjs

Exercises the public API exported from `src/index.js` (`OpenLcb.create()`,
`createNode()`, `node.sendPcer()`, codec namespaces, `start()`/`stop()`)
against a mock transport. Asserts:

- `OpenLcb.create()` resolves and the codec namespaces (`float16`,
  `broadcastTime`, `dccDetector`, `trainSearch`, `util`) are wired.
- `node.loginComplete` resolves and CID / RID / AMD / Initialization
  Complete frames are emitted.
- Every outbound chunk ends with the GridConnect terminator (`\n`).
- `node.sendPcer()` emits a PCER frame for the requested event ID.
- `createNode({ cdi: Uint8Array })` and `createNode({ cdi: string })`
  both stage the CDI bytes through `wasm_node_set_cdi`.
- `openlcb.stop()` closes the transport.

Use this when changing anything in `src/openlcb/`, `src/drivers/`,
`src/storage/`, or the runtime/dispatcher wiring.

```bash
node test/wrapper_smoke.mjs
```

## Adding new tests

These are intentionally one-file scripts — a smoke pass, not a full
suite. If a wider test surface is needed (conformance harness, JMRI
interop suite, multi-node scenarios), add it as a sibling `.mjs`
file and document it here. There is no shared harness; each test
sets up its own mock transport / WASM module.

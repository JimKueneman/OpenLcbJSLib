> **HISTORICAL — archived.** This is the migration plan that drove the move from a pure-JS port to the current WASM-wrapper architecture. The migration has been executed; the sketches of `src/wrapper/`, `src/transport/`, and `src/wasm/` here do not match the shipped layout. Kept for context only. For the current public API see [../api_design.md](../api_design.md) and the root [README.md](../../README.md).

---

# OpenLcbJSLib — WASM Wrapper Migration Plan

## Goal

Replace the current JS reimplementation of the OpenLCB protocol with a thin hand-written wrapper around a WebAssembly build of OpenLcbCLib. End state: bug fixes happen once (in C), and this library picks them up on WASM rebuild. `src/` shrinks to wrapper + transport only.

## Context

- Decision made in a prior planning conversation. OpenLcbCLib is the single source of truth going forward.
- Sibling repo `OpenLcbCLib` has already completed its side:
  - Milestone 1: Emscripten toolchain proof-of-concept — done.
  - Milestone 2: Debug `printf` gated behind `OPENLCB_DEBUG_PRINTF` — done.
  - Milestone 3: One callback round-trip C↔JS proven — done.
  - Milestone 4: Build artifact + handoff — pending (producing `openlcb-core.wasm` + `.js` glue).
- Audit confirmed the C lib has a clean HAL boundary (function-pointer interface structs), no malloc in core, no threading. It is well-suited for WASM.

## Scope

**In scope (this repo):**
- Vendor the WASM artifact from OpenLcbCLib.
- Write the hand-written JS wrapper that matches the current public API surface.
- Keep WebSocket transport in JS — wire CAN frames into the WASM RX entry point.
- Run existing examples unchanged against the new wrapper.
- Delete old `src/` protocol code (state machines, FIFOs, message handlers) once the wrapper passes.

**Out of scope:**
- Any C-side changes — those belong in OpenLcbCLib.
- Reimplementing the protocol logic in JS for any reason.

## Current public API shape to preserve

Consumers currently do roughly:

```js
const config = new OpenLcbConfig({ websocketUrl, callbacks, ... });
const node = config.createNode(nodeId, parameters);
config.start();
application.sendEventPcReport(node, eventId);
```

Callbacks object shape (approximate — verify against `src/` and examples before freezing):
`onLoginComplete`, `onPcEventReport`, `onConsumedEventIdentified`, plus config memory read/write hooks.

The wrapper's job is to keep this shape intact so consumer apps do not change.

## Proposed repo layout after migration

```
OpenLcbJSLib/
├── src/
│   ├── wrapper/            hand-written JS wrapper (public API surface)
│   │   ├── OpenLcbConfig.js
│   │   ├── callbacks.js    C-struct-callback ↔ JS-object-callback marshalling
│   │   ├── memory.js       _malloc/_free helpers, string/struct marshalling
│   │   └── runloop.js      setInterval driver for _run and _100ms_timer_tick
│   ├── transport/          WebSocket transport, stays in JS
│   └── wasm/               vendored from OpenLcbCLib/wasm/dist/
│       ├── openlcb-core.wasm
│       └── openlcb-core.js (Emscripten glue)
├── examples/               unchanged — proves wrapper fidelity
├── test/                   conformance tests (see milestone 4)
└── dist/                   built library output
```

Confirm with user before creating any new folders — per CLAUDE.md, no folders created without explicit permission.

## Milestones

### 1. Vendor the artifact
- Copy `openlcb-core.wasm` + `openlcb-core.js` from OpenLcbCLib's build output into this repo.
- Decide: check into git, or pull via a build script? Recommend check-in for now — simpler, pinned, reproducible.
- Record the OpenLcbCLib commit hash the artifact was built from (e.g. in `src/wasm/VERSION`).
- **Exit criterion:** Node can load the WASM module, call `_init`/`_run`/`_100ms_timer_tick` exports.

### 2. Marshalling layer
- Write `src/wrapper/memory.js`: helpers for `_malloc`/`_free`, `UTF8ToString`, `HEAPU8` slice reads, struct packing/unpacking for OpenLCB message types.
- Write `src/wrapper/callbacks.js`: register JS functions into C via `addFunction`, translate C pointer/index arguments into JS objects matching the existing callbacks shape.
- **Exit criterion:** one C→JS callback and one JS→C call work end-to-end from a unit test (mirror the PoC done on the C side).

### 3. Public API wrapper
- Write `src/wrapper/OpenLcbConfig.js` with the same constructor signature and method names as today's `OpenLcbConfig`.
- `start()` spins up `setInterval` driving `_run` + `_100ms_timer_tick`.
- `createNode`, `sendEventPcReport`, and the rest delegate to WASM exports.
- Transport stays in `src/transport/` — WebSocket frames feed into the WASM CAN RX entry point.
- **Exit criterion:** `examples/basic_node/basic-node.html` runs unchanged against the new wrapper.

### 4. Conformance tests (critical — this is where drift can hide)
- Build a small suite that feeds known message traces into the wrapper and asserts the emitted frames match expected output.
- Same tests should be runnable against the current JS impl (before deletion) and the new wrapper, to confirm behavioral equivalence.
- **Exit criterion:** both implementations pass the same trace tests.

### 5. Delete `src/` protocol code
- Once milestone 4 passes and examples work, delete the old state machine / FIFO / message-handler code.
- What remains in `src/`: `wrapper/`, `transport/`, `wasm/`.
- Update `package.json` entry points and `dist/` build if needed.
- **Exit criterion:** `git grep` shows no references to deleted modules; `npm test` and examples still green.

## Known risks / watch items

1. **Callback marshalling is the one layer not shared between C and JS.** Keep it thin. The conformance tests in milestone 4 are the guard rail — do not skip them.
2. **Config memory semantics.** C assumes byte-addressable flash/EEPROM. JS side will back this with IndexedDB or localStorage; must match read/write offset model exactly. Write a focused test for this specifically.
3. **Memory lifecycle across the boundary.** Every `_malloc` needs a matching `_free`. Centralize in `memory.js`, do not sprinkle across the wrapper.
4. **Bundle size.** WASM is ~100–150KB per the C-side estimate. Measure against current `dist/` size; flag to user if it regresses web deployment.
5. **Versioning coupling.** This repo now depends on OpenLcbCLib build artifacts. Record the source commit hash of every vendored `.wasm`. When a C-side fix ships, rebuild and re-vendor.
6. **Debugging ergonomics.** Stack traces go through WASM. Keep Emscripten source maps available in dev builds.

## Rules reminders (from CLAUDE.md)

- Never just agree — push back if there is a better approach.
- Wait for explicit approval before making changes.
- Never start modifying code without permission.
- Never guess — stop and ask.
- Never create folders without permission.
- If a test looks right and fails, stop and report. Do not force a pass.
- Keep responses concise.

(The `OPENLCB_COMPILE_*` ifdef rules and interface-struct rules are C-side concerns and do not apply here. Feature gating is decided at C build time and baked into the vendored `.wasm`.)

## First action for the new conversation

Read this file, then confirm the plan with the user. Before doing anything, verify the current public API shape by reading `src/` and at least one example (`examples/basic_node/basic-node.html`) so the wrapper target is grounded in reality, not assumed. Do not start writing code until the user approves milestone 1 and the specific files that will be touched.

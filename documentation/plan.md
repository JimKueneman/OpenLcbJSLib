# OpenLcbCLib -> JavaScript Port Plan

## Context

Port the OpenLcbCLib C library to a plain JavaScript library for browser use. The JS library connects to OpenLCB networks via WebSocket carrying GridConnect ASCII strings. Since GridConnect is an ASCII encoding of CAN frames, the CAN protocol framing (alias negotiation, multi-frame assembly, MTI extraction from CAN IDs) must be ported -- but not the raw hardware CAN driver.

**Constraints**
- Plain JavaScript (no TypeScript, no build step required)
- Browser only (no Node.js target)
- Transport: GridConnect ASCII over WebSocket
- All protocol modules included (no feature flags / conditional compilation)
- Multi-node (virtual nodes) support
- ES modules (`import`/`export`) so the library loads directly in the browser
- No binary TCP framing (the `src/drivers/tcp_ip/` 17-byte preamble transport is out of scope)

**Source C library:** `/Users/jimkueneman/Documents/OpenLcbCLib/`
**Target project:** `/Users/jimkueneman/Documents/OpenLcbJSLib/`
**Conformance tests:** `/Users/jimkueneman/Documents/OlcbCheckerClone/` (final acceptance gate)

---

## Why Exclude Binary TCP Framing

Binary TCP is a parallel transport to CAN+GridConnect, not an extension of it:

- Separate 17-byte framing (flags, source/dest node IDs, length, MTI)
- Separate addressing (full 48-bit Node IDs directly -- no aliases, no CID/RID/AMD)
- Separate link-layer control messages

Supporting both would mean a second RX/TX path, a second login/init sequence, and a second addressing path through every protocol handler. The JMRI / OpenLCB hub ecosystem speaks GridConnect in practice, so a WebSocket + GridConnect client plugs into everything that matters.

---

## No Conditional Compilation

The C library uses `OPENLCB_COMPILE_*` macros to gate every optional protocol (events, datagrams, memory config, streams, trains, broadcast time, firmware upgrade, etc.) so embedded targets can omit unused code. **The JS port drops this entire mechanism.**

- No `OPENLCB_COMPILE_*` equivalents -- no constants, no runtime flags, no build-time toggles
- Every protocol handler module is always imported and always wired into `config.js`
- `config.js` unconditionally calls `initialize()` on every handler in the correct order
- The MTI dispatch table in `main-statemachine.js` always includes every handler
- No "minimal build" variants -- there is one build, and it does everything

Rationale: browsers are not code-size constrained the way PIC/AVR targets are, ES module tree-shaking is a bundler concern (and the library targets plain `<script type="module">` without a bundler), and removing the guards eliminates a large class of porting bugs where a feature silently disappears because its flag wasn't set.

If a future consumer needs a trimmed build, that becomes their bundler's problem, not the library's.

---

## What Gets Deleted

- **Buffer pools** (`openlcb_buffer_store`, `openlcb_buffer_list`) -- JS has GC; messages are plain objects
- **Lock/unlock callbacks** -- browser is single-threaded
- **Feature flag guards** (`#ifdef OPENLCB_COMPILE_*`) -- everything included
- **Raw CAN hardware driver** (`can_rx_statemachine`, `can_tx_statemachine`) -- replaced by WebSocket
- **TCP binary framing** (`src/drivers/tcp_ip/*`) -- out of scope
- **Compile-time config headers** (`openlcb_user_config.h`, `can_user_config.h`) -- becomes runtime constructor options
- **Bootloader** (`bootloader/`) -- standalone codebase, not part of library port
- **DCC detector application** (`openlcb_application_dcc_detector`) -- hardware-specific, out of scope

## What Stays the Same (structurally)

- Main state machine priority phases and MTI dispatch table
- Login state machine (CAN alias negotiation + OpenLCB initialization)
- Node pool with key-based enumerators
- All protocol handlers (same logic, JS objects instead of structs)
- DI pattern (interface structs become JS objects with function properties)
- GridConnect codec (string-based in JS)
- 100ms tick counter for timeouts
- Sibling dispatch for virtual multi-node

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Node ID / Event ID | `BigInt` | 48/64-bit values need exact bit ops; hex literals with `n` suffix |
| Messages | Plain `{}` with `Uint8Array` payload | No pools needed with GC |
| CAN frames | Plain `{}` with `identifier` (Number, 29-bit fits) + `Uint8Array` | Same |
| FIFO | `Array.push()` / `Array.shift()` | Simple, adequate for browser throughput |
| DI pattern | Object with function properties | Direct equivalent of C interface structs |
| Run loop | `requestAnimationFrame` | ~60Hz polling, non-blocking, browser-native |
| Timer tick | `setInterval(fn, 100)` | Matches C's 100ms tick |
| Module system | ES modules (`import`/`export`) | Browser-native, no bundler required |
| CAN framing | Ported (GridConnect requires it) | Alias negotiation, multi-frame assembly |
| Errors | Return codes on hot paths; `throw` only on programmer errors | Mirrors C return semantics |
| Binary data | `Uint8Array` everywhere | Avoid string/array conversions |

---

## Transport Architecture

```
Application / protocol handlers (MTI-level)
    |
CAN framing  (aliases, multi-frame assembly)    <- ported from src/drivers/canbus/
    |
GridConnect codec  (ASCII <-> CAN frame)        <- ported from openlcb_gridconnect.c
    |
WebSocket (browser native)                      <- thin new glue layer
```

```
Browser                          Server (JMRI / Hub / Bridge)
  |                                 |
  |  ws.send(":X19170640N...;")     |
  |-------------------------------->|
  |                                 |--- CAN bus or internal routing
  |  ws.onmessage(":X19100...;")    |
  |<--------------------------------|
```

- **RX:** `ws.onmessage` -> GridConnect parser -> CAN RX handler (multi-frame assembly) -> message FIFO -> main state machine dispatch
- **TX:** main state machine -> CAN TX handler (segmentation) -> GridConnect encoder -> `ws.send()`

---

## Directory Layout

```
OpenLcbJSLib/
  documentation/
    plan.md                           <- this file

  src/
    openlcb/
      defines.js                      <- openlcb_defines.h (all MTI, error, address space constants)
      types.js                        <- openlcb_types.h (message/node factory functions)
      utilities.js                    <- openlcb_utilities.h/c (payload insert/extract, MTI helpers)
      float16.js                      <- openlcb_float16.h/c (IEEE 754 half-precision)
      gridconnect.js                  <- openlcb_gridconnect.h/c (ASCII codec)
      message-fifo.js                 <- replaces openlcb_buffer_fifo (simple array queue)
      node.js                         <- openlcb_node.h/c (node pool with enumerators)
      login-statemachine.js           <- openlcb_login_statemachine.h/c + _handler.h/c merged
      main-statemachine.js            <- openlcb_main_statemachine.h/c (MTI dispatcher)
      application.js                  <- openlcb_application.h/c
      application-train.js            <- openlcb_application_train.h/c
      application-broadcast-time.js   <- openlcb_application_broadcast_time.h/c
      config.js                       <- openlcb_config.c (factory/builder/wiring)

    protocol/
      message-network.js              <- protocol_message_network.h/c
      snip.js                         <- protocol_snip.h/c
      event-transport.js              <- protocol_event_transport.h/c
      datagram-handler.js             <- protocol_datagram_handler.h/c
      config-mem-read.js              <- protocol_config_mem_read_handler.h/c
      config-mem-write.js             <- protocol_config_mem_write_handler.h/c
      config-mem-operations.js        <- protocol_config_mem_operations_handler.h/c
      config-mem-stream.js            <- protocol_config_mem_stream_handler.h/c
      stream-handler.js               <- protocol_stream_handler.h/c
      train-handler.js                <- protocol_train_handler.h/c
      train-search-handler.js         <- protocol_train_search_handler.h/c
      broadcast-time-handler.js       <- protocol_broadcast_time_handler.h/c

    drivers/
      can/
        types.js                      <- can_types.h
        utilities.js                  <- can_utilities.h/c (MTI extraction from CAN ID)
        alias-mappings.js             <- internal_node_alias_table.h/c
        alias-mapping-listener.js     <- alias_mapping_listener.h/c (listener alias table)
        buffer-fifo.js                <- can_buffer_fifo.h/c (simple array queue)
        rx-message-handler.js         <- can_rx_message_handler.h/c (multi-frame assembly)
        tx-message-handler.js         <- can_tx_message_handler.h/c (message segmentation)
        login-message-handler.js      <- can_login_message_handler.h/c (CID/RID/AMD/AME/AMR handling)
        login-statemachine.js         <- can_login_statemachine.h/c (alias negotiation SM)
        main-statemachine.js          <- can_main_statemachine.h/c (CAN-layer dispatcher)
      websocket/
        transport.js                  <- NEW: WebSocket connection + GridConnect glue

    index.js                          <- Public API entry point (re-exports config.js)

  test/                               <- Mirrors src/ structure; ports *_Test.cxx fixtures
  examples/
    basic-node.html                   <- Minimal working example
```

~35 source files. C -> JS shrinkage expected from removing header/source duplication, buffer pool machinery, and `#ifdef` guards.

---

## Implementation Order

Each phase is independently testable. Tests for each module port the corresponding `*_Test.cxx` fixtures from the C suite.

### Phase 1 -- Foundation (no dependencies)
1. `openlcb/defines.js` -- All protocol constants from `openlcb_defines.h`
2. `openlcb/types.js` -- Factory functions: `createMessage()`, `createNode()`, `createEvent()`
3. `openlcb/utilities.js` -- Payload insert/extract (big-endian), MTI helpers
4. `openlcb/float16.js` -- IEEE 754 half-precision conversion
5. `openlcb/message-fifo.js` -- Simple array-based FIFO
6. `drivers/can/types.js` -- `createCanMsg()`, CAN framing constants

### Phase 2 -- GridConnect + CAN Framing (testable with string I/O)
7. `openlcb/gridconnect.js` -- Parser (streaming) and encoder
8. `drivers/can/utilities.js` -- MTI/alias extraction from 29-bit CAN identifier
9. `drivers/can/buffer-fifo.js` -- CAN frame queue
10. `drivers/can/alias-mappings.js` -- Alias-to-NodeID table (mutator/lookup)
11. `drivers/can/alias-mapping-listener.js` -- Listener alias table (for train search)
12. `drivers/can/rx-message-handler.js` -- CAN frame reassembly into OpenLCB messages
13. `drivers/can/tx-message-handler.js` -- OpenLCB message segmentation into CAN frames

### Phase 3 -- Node and Login (testable without network, with fake transport)
14. `openlcb/node.js` -- Node pool with key-based enumerators
15. `drivers/can/login-message-handler.js` -- CID/RID/AMD/AME/AMR frame handling
16. `drivers/can/login-statemachine.js` -- Alias negotiation state machine (200ms wait, duplicate detection)
17. `drivers/can/main-statemachine.js` -- CAN-layer dispatcher (RX/TX priority)
18. `openlcb/login-statemachine.js` -- OpenLCB node initialization sequence (Initialization Complete, Event broadcast)

### Phase 4 -- Core Protocol Handlers (testable with mock transport)
19. `protocol/message-network.js` -- Verify Node ID, Protocol Support Inquiry/Reply
20. `protocol/snip.js` -- Simple Node Information
21. `protocol/event-transport.js` -- Producer/Consumer/PCER events
22. `protocol/datagram-handler.js` -- Datagram transport with ACK/retry
23. `openlcb/main-statemachine.js` -- Central MTI dispatcher with priority phases and sibling dispatch

### Phase 5 -- Advanced Protocol Handlers
24. `protocol/config-mem-read.js`
25. `protocol/config-mem-write.js`
26. `protocol/config-mem-operations.js`
27. `protocol/stream-handler.js`
28. `protocol/config-mem-stream.js`
29. `protocol/train-handler.js`
30. `protocol/train-search-handler.js`
31. `protocol/broadcast-time-handler.js`

### Phase 6 -- Application Layer
32. `openlcb/application.js`
33. `openlcb/application-train.js`
34. `openlcb/application-broadcast-time.js`

### Phase 7 -- Transport + Wiring
35. `drivers/websocket/transport.js` -- WebSocket lifecycle (connect/reconnect/disconnect), GridConnect send/receive, bridges raw WS frames to CAN RX FIFO and CAN TX queue
36. `openlcb/config.js` -- Central factory: builds DI objects, injects callbacks, calls `initialize()` in order, exposes public API surface
37. `index.js` -- Public API exports

### Phase 8 -- Integration
38. End-to-end browser test against live JMRI / GridConnect server
39. `examples/basic-node.html` -- Minimal working example
40. OlcbCheckerClone conformance run against the JS node -- acceptance gate

---

## Main Loop in Browser

```javascript
// 100ms tick (independent of run loop)
let tick = 0;
setInterval(() => { tick = (tick + 1) & 0xFF; }, 100);

// Run loop (~60Hz via requestAnimationFrame)
function mainLoop() {
    canMainStatemachine.run(tick);    // drain CAN RX, run CAN login, emit CAN TX
    loginStatemachine.run(tick);      // OpenLCB node init sequence
    mainStatemachine.run(tick);       // MTI dispatch to protocol handlers
    configMemStreamHandler.run();     // long-running stream transfers
    runPeriodicServices(tick);        // broadcast time, datagram retries, etc.
    requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);
```

---

## User-Facing API Sketch

```javascript
import { OpenLcbConfig } from './src/openlcb/config.js';

const config = OpenLcbConfig.initialize({
    websocketUrl: 'ws://localhost:12021',

    // Persistence callbacks
    configMemRead:  (node, space, address, count) => { /* return Uint8Array */ },
    configMemWrite: (node, space, address, count, data) => { /* ... */ },

    // Event callbacks
    onLoginComplete:       (node) => { /* ... */ },
    onEventReceived:       (node, eventId) => { /* ... */ },
    onTrainSpeedChanged:   (node, speed) => { /* ... */ },
    onTrainFunctionChanged:(node, fn, value) => { /* ... */ },
    // ... other callbacks
});

const node = config.createNode(0x050101010700n, nodeParams);
config.start();
```

---

## Testing Strategy

The C library has ~53 `*_Test.cxx` fixtures with high per-module coverage plus multi-node end-to-end suites. Those tests are the port specification.

- **Per-module tests:** For each JS module, translate the corresponding `*_Test.cxx` file. Mock DI interfaces are already the C test pattern and map directly to JS objects with function properties.
- **Test runner:** Lightweight browser-compatible runner (e.g. plain `<script type="module">` harness, or a single small test framework) -- no Node.js dependency.
- **Mock transport:** Capture outgoing GridConnect strings in an array; pre-load incoming strings into the RX FIFO; step the main loop manually.
- **Integration:** Connect to JMRI (or an OpenLCB hub) via WebSocket, verify node discovery, event exchange, CDI read/write.
- **Acceptance gate:** OlcbCheckerClone run against the JS node. The C library already passes this on real hardware; the JS port must reach the same bar.

---

## Critical C Files to Reference During Port

| Area | C file |
|---|---|
| Wiring & init order | `src/openlcb/openlcb_config.c` |
| MTI dispatcher / priority phases | `src/openlcb/openlcb_main_statemachine.c` |
| All type definitions | `src/openlcb/openlcb_types.h` |
| All protocol constants | `src/openlcb/openlcb_defines.h` |
| Node pool | `src/openlcb/openlcb_node.c` |
| OpenLCB login | `src/openlcb/openlcb_login_statemachine.c` + `_handler.c` |
| CAN frame reassembly | `src/drivers/canbus/can_rx_message_handler.c` |
| CAN message segmentation | `src/drivers/canbus/can_tx_message_handler.c` |
| Alias negotiation | `src/drivers/canbus/can_login_statemachine.c` |
| CAN login frame handling | `src/drivers/canbus/can_login_message_handler.c` |
| GridConnect codec | `src/openlcb/openlcb_gridconnect.c` |
| Alias table | `src/drivers/canbus/internal_node_alias_table.c` |
| Listener alias table | `src/drivers/canbus/alias_mapping_listener.c` |

---

## Example App Layout — Internal Convention (not a user-facing rule)

When adding a new example under `examples/<name>/`, mirror the
OpenLcbCLib `applications/.../<name>/` pattern: each "type" of OpenLCB
node a host allocates gets one configuration file and (when present)
one CDI XML plus one FDI XML.  The eventual generator tool (see
`tools/`, not yet built) produces these `.js` files from the XML;
until it lands, they are hand-derived in lockstep.

This is for us when authoring examples in this repo.  It is NOT a
rule end users must follow when building their own apps — they can
structure their projects however they like; the library only sees the
parameters object passed to `createNode()`.

### Single-type apps (one node type)

Unsuffixed names:

| File | Purpose |
|------|---------|
| `openlcb_user_config.js` | parameters struct (mirror of `OpenLcbUserConfig_node_parameters` in C) |
| `cdi.xml` | source CDI XML (input to generator) |
| `fdi.xml` | source FDI XML (only if the node is a train) |

Examples today: `examples/basic_node/`, `examples/train_throttle/`.

### Multi-type apps (host with N virtual node types)

Every type's files take a `_<type>` suffix, including the host's own
root.  No mixing of suffixed and unsuffixed names within one app:

| File pattern | Purpose |
|--------------|---------|
| `openlcb_user_config_<type>.js` | per-type parameters file (fixed struct for the host root, factory function for each virtual type) |
| `cdi_<type>.xml` | per-type CDI XML |
| `fdi_<type>.xml` | per-type FDI XML |

Example today — Train Command Station (two types: the CS host root and
the virtual-train type):

```
examples/train_command_station/
├── command-station.{html,css,js}
├── openlcb_user_config_command_station.js   ← host root config
├── openlcb_user_config_train.js             ← per-train factory
├── cdi_command_station.xml                  ← (when added)
├── cdi_train.xml                            ← (when added)
└── fdi_train.xml                            ← (when added)
```

### Conventions inside each file

- The exported parameters identifier matches the C identifier
  letter-for-letter — `OpenLcbUserConfig_node_parameters` for fixed
  structs.  Cross-binding consistency wins over JS camelCase orthodoxy.
- A factory file additionally exports `makeXxxNodeParameters({...})`
  taking the per-instance bits (DCC address, name, …) and returning a
  fresh parameters object.  Shared bytes (e.g. an FDI `Uint8Array`)
  are module-level constants captured by the factory closure; the
  library copies them per `createNode()` call into C heap, so the JS
  source bytes are shared but every C-side `parameters->fdi` pointer
  is independent.
- A `NODE_ID` `const` is exported at module top-level for the form's
  default Node ID input.  The user can still override before connect.

### Future generator CLI (not yet built)

Takes one XML pair, emits one `.js` file.  The `--type` flag controls
naming uniformly:

```
openlcb-gen-params --cdi cdi.xml --out openlcb_user_config.js
openlcb-gen-params --cdi cdi_train.xml --fdi fdi_train.xml \
                   --out openlcb_user_config_train.js \
                   --type train --factory
```

`--type <name>` omitted → unsuffixed file names.  `--type <name>`
present → all output filenames take the `_<name>` suffix.

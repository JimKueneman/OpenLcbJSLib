# Train Command Station Example — Plan

> **Banner:** API references in this doc reflect the pre-rewrite legacy
> pure-JS stack. Use as design intent only; the new WASM-based API will be
> redesigned in Phase 2 and this doc updated to match.

Browser-based DCC command station proxy that pairs with the Train Throttle
example (`examples/train_throttle/`). Acts as a gateway: represents each
controlled locomotive as a **virtual OpenLCB Train Node** on the bus, and
translates Train Control Protocol messages into a pluggable "track driver"
callback (real DCC output deferred; mocked for v1).

Implemented entirely via the library's application-facing API — the CS
does not touch the CAN/alias layers, protocol handlers, or state machines
directly.

---

## Responsibilities

1. **Represent the CS itself** as one OpenLCB node (for SNIP / PIP
   discovery by throttles). Optional — can be skipped in v1; trains alone
   will work.
2. **Maintain a roster** of virtual train nodes, one per DCC locomotive.
3. **Allocate train nodes on demand** in response to throttle Train-Search
   messages that carry the Allocate flag (TrainSearchS §6.2).
4. **Drive the track** by reacting to TrainControl Command messages sent
   to any of its virtual trains. The library's built-in
   `ProtocolTrainHandler` already decodes these and updates the
   `trainState`; the CS only needs to observe the change and push it to
   the track driver.
5. **Maintain heartbeats** on trains that have an assigned controller
   (set `trainState.heartbeatTimeoutS` if desired; library does the
   countdown).

---

## Library surface used

All wiring is through `OpenLcbConfig`, mirroring `examples/basic_node`:

| Need                                | API                                                              |
|-------------------------------------|------------------------------------------------------------------|
| Transport + lifecycle               | `new OpenLcbConfig({ websocketUrl, callbacks, … })`              |
| Allocate a virtual node             | `config.createNode(nodeId, parameters)`                          |
| Attach Train state to a node        | `config.applicationTrain.setup(trainNode)`                       |
| Set DCC address / long flag         | `config.applicationTrain.setDccAddress(node, addr, isLong)`      |
| Set speed-step preference           | `config.applicationTrain.setSpeedSteps(node, steps)`             |
| Allocate-on-search callback         | `callbacks.onTrainSearchNoMatch(searchAddress, flags)` returns the newly-created train node, or `null` to decline |
| Observe set-speed (on each train)   | `callbacks.onTrainSpeedChanged(node, float16Speed)`              |
| Observe set-function                | `callbacks.onTrainFunctionChanged(node, fnAddress, value)`       |
| Observe emergency state             | `callbacks.onTrainEmergencyEntered/Exited(node, type)`           |
| Observe heartbeat expiry            | `callbacks.onTrainHeartbeatTimeout(node)`                        |
| Minimal config memory               | `configMemoryRead/Write` callbacks (return zeros / accept any)   |

**Note — fully covered by existing library API.** No gaps identified for
the CS side during plan review. (The Throttle side has one gap — see
`examples/train_throttle/PLAN.md` #1.)

---

## Virtual train Node ID allocation

Each virtual train needs a globally-unique 48-bit Node ID. Two options:

- **Derived from DCC address (recommended for v1).** Namespace the CS's
  base ID and append the DCC address, e.g.
  `baseId = 0x050101010800n`, train node ID = `baseId | BigInt(addr)`.
  Deterministic and restart-safe.
- **Random within a block.** Generate a random node ID per allocation.
  Requires persistence to stay stable across restarts.

Recommendation: derived. Document the block; the user sets a CS base ID
in the Connect screen, same as they set the throttle node ID today.

---

## Train node parameters (per virtual train)

Passed to `config.createNode(...)`. Based on `examples/basic_node`:

```js
config.createNode(trainNodeId, {
    protocolSupport: defines.PSI_EVENT_EXCHANGE
                   | defines.PSI_SIMPLE_NODE_INFORMATION
                   | defines.PSI_TRAIN_CONTROL,    // verify exact flag name
    consumerCountAutocreate: 0,
    producerCountAutocreate: 0,
    snip: {
        mfgVersion: 1,
        name: `DCC ${dccAddr}`,
        model: 'Virtual Train',
        hardwareVersion: '1.0',
        softwareVersion: defines.OPENLCB_JS_LIB_VERSION,
        userVersion: 1,
    },
    addressSpaceConfigurationDefinitionInfo: { present: false, highestAddress: 0 },
    addressSpaceAll:                          { present: false, highestAddress: 0 },
    addressSpaceConfigMemory:                 { present: false, highestAddress: 0 },
    addressSpaceAcdiManufacturer:             { present: false, highestAddress: 0 },
    addressSpaceAcdiUser:                     { present: false, highestAddress: 0 },
    addressSpaceTrainFunctionDefinitionInfo:  { present: false, highestAddress: 0 },
    addressSpaceTrainFunctionConfigMemory:    { present: false, highestAddress: 0 },
    addressSpaceFirmware:                     { present: false, highestAddress: 0 },
    configurationOptions: {},
});
```

Then **attach train state and populate metadata**:

```js
config.applicationTrain.setup(trainNode);
config.applicationTrain.setDccAddress(trainNode, dccAddr, isLongAddr);
config.applicationTrain.setSpeedSteps(trainNode, 128);  // or 14 / 28 per flags
// Optional: enforce a heartbeat window.
trainNode.trainState.heartbeatTimeoutS = 10;
```

The library then:
- Registers the `Is Train` producer event and the four emergency consumer
  events.
- Auto-responds to Train-Search events that match this train's DCC address
  or SNIP name.
- Auto-handles controller-assign / release / speed / function / query
  messages via `ProtocolTrainHandler`.
- Runs the heartbeat countdown on the 100ms tick and fires
  `onTrainHeartbeatTimeout` if the controller goes silent.

---

## Flow — allocate-on-search (TrainSearchS §6.2)

Throttle sends a Train-Search event with bit 7 (Allocate) set and a desired
DCC address. Library enumerates existing trains first; if none match, it
calls our callback:

```js
onTrainSearchNoMatch(searchAddress, flags) {
    // Derive node ID; respect long-address flag from the search.
    const isLong = !!(flags & 0x04);  // TRAIN_SEARCH_FLAG_LONG_ADDR
    const nodeId = baseId | BigInt(searchAddress);
    const node = config.createNode(nodeId, trainParams(searchAddress, isLong));
    config.applicationTrain.setup(node);
    config.applicationTrain.setDccAddress(node, searchAddress, isLong);
    config.applicationTrain.setSpeedSteps(node, stepsFromFlags(flags));
    roster.set(searchAddress, node);
    // Library emits Producer Identified for the search event on our behalf
    // once we return this node.
    return node;
}
```

Spec requires the CS to wait at least 200ms for existing trains to reply
before allocating. The library's search handler already performs the
enumeration sweep across all nodes in the pool before invoking
`onSearchNoMatch`; verify the 200ms debounce is honored or add a timer.

---

## Flow — driving the track

The library decodes incoming TrainControl Commands, updates
`node.trainState.setSpeed` (float16) and `node.trainState.functions[n]`,
and fires application callbacks. The CS consumes those:

```js
onTrainSpeedChanged(node, speed) {
    // speed is float16 bit-pattern, signed, scale-m/s.
    const mps = OpenLCB.float16.toFloat32(speed);
    trackDriver.setSpeed(node.trainState.dccAddress, mps, node.trainState.isLongAddress);
}

onTrainFunctionChanged(node, fnAddress, value) {
    trackDriver.setFunction(node.trainState.dccAddress, fnAddress, value);
}

onTrainEmergencyEntered(node, type) {
    trackDriver.eStop(node.trainState.dccAddress);
}
onTrainEmergencyExited(node, type) {
    // train will resume at stored setSpeed on its own; driver may need
    // to re-assert the current speed depending on track-protocol semantics.
}
```

### Track driver interface (v1: mock)

A tiny object the app can swap. Keeps the example testable without any
real hardware.

```js
const trackDriver = {
    setSpeed(dccAddr, mps, isLong)      { log(`DCC ${dccAddr}: ${mps.toFixed(2)} m/s`); },
    setFunction(dccAddr, fnAddr, value) { log(`DCC ${dccAddr}: F${fnAddr}=${value}`); },
    eStop(dccAddr)                      { log(`DCC ${dccAddr}: ESTOP`); },
};
```

Real DCC output (via serial, WebSerial, or a JMRI/DCC-EX backend)
deferred to v2.

---

## Heartbeats

- Train-side heartbeat logic is already in
  `OpenLcbApplicationTrain.timerTick`. It decrements each train's
  `heartbeatCounter100ms`, sends a `Heartbeat Request` to the assigned
  controller at the halfway point, and estops + forwards to listeners on
  expiry.
- **The CS just needs to set `trainState.heartbeatTimeoutS`** on each
  train it wants to enforce. Default: 10s (TrainControlTN §2.6.6).
- When a timeout fires, `onTrainHeartbeatTimeout(node)` fires so the CS
  UI can surface it.

---

## Global emergency handling

Incoming `Emergency Stop All` / `Emergency Off All` PCERs are decoded by
the library; each allocated train's `trainState` is updated and
`onTrainEmergencyEntered(node, type)` fires. The CS driver estops each
affected DCC address.

The CS also chooses whether to *originate* a global emergency — e.g. a
big red button in the UI — by calling
`config.application.sendEventPcReport(csNode, EMERGENCY_STOP_ALL_EVENT)`.

---

## UI structure — desktop only

This is a **desktop computer app**, not a phone app. Assume a wide window,
keyboard + mouse, multiple simultaneous panels visible at once. No mobile
breakpoints, no safe-area insets, no phone-sized single-card stack.

Target layout — multi-pane, fills the window:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Top bar: CS name • connection pill • Global Emergency buttons       │
├──────────────────────────┬──────────────────────────────────────────┤
│ Left pane                │ Right pane                               │
│   Connect form           │   Roster table (wide, many columns)      │
│   Add-train form         │   Row actions: Select / Remove / EStop   │
│                          │                                          │
│                          ├──────────────────────────────────────────┤
│                          │ Track log (scrolling, monospaced)        │
└──────────────────────────┴──────────────────────────────────────────┘
```

Panels:

1. **Top bar** — CS identity, connection status pill, layout-wide
   Emergency Stop All / Emergency Off All (+ Clear) buttons.
2. **Connect form** (left) — WebSocket URL, CS base Node ID,
   Connect/Disconnect. Small.
3. **Add-train form** (left, **debug/test only**) — DCC address,
   long/short, speed steps, optional SNIP name. Creates a virtual node
   directly, bypassing the normal allocate-on-search flow. Not part of
   the production operator workflow; kept for bring-up and testing. Gate
   behind a "Debug tools" toggle / collapsed section so it doesn't clutter
   the operational UI.
4. **Roster table** (right, top) — one row per virtual train with
   columns: DCC addr / long / SNIP name / speed (m/s + mph) / direction
   / active functions (bitmap or F0–F28 chips) / controller Node ID /
   heartbeat state / last activity. Row actions: Remove, Force EStop.
5. **Track log** (right, bottom) — scrolling monospaced panel showing
   driver-level commands (`setSpeed`, `setFunction`, `eStop`) as they are
   emitted by the mock driver, plus controller-assign/release events.

Styling: same dark palette as `throttle.html` for visual consistency,
but desktop-sized — full window width, no `max-width`, no
`viewport-fit=cover`, no rotated-slider/touch-target tricks. Use native
HTML controls (table, buttons, inputs) without touch-friendly oversize
padding.

---

## Files

- `command-station.html` — single-page UI + wiring. To be created.
- `openlcb.bundle.js` — copy of `dist/openlcb.bundle.js` (same pattern as
  `examples/basic_node/`). Not yet present.
- `PLAN.md` — this file.

---

## Status

- [ ] UI scaffold (Connect / Roster / Add / Log / Global Emergency).
- [ ] CS base-node allocation + login (optional).
- [ ] `Add train` form (debug only) → `createNode` + `applicationTrain.setup`.
- [ ] `onTrainSearchNoMatch` wired to dynamic allocation.
- [ ] `onTrainSpeedChanged` / `onTrainFunctionChanged` / emergency →
      mock track driver.
- [ ] Heartbeat configuration + `onTrainHeartbeatTimeout` surface in UI.
- [ ] Global emergency originate / display.
- [ ] Persistence of roster across reloads. *(deferred v2)*
- [ ] Real DCC output (WebSerial to DCC-EX, or JMRI bridge). *(deferred v2)*
- [ ] FDI (0xFA) publishing per train for richer throttle labels.
      *(deferred v2 — depends on library work, see CDI/FDI status below)*

---

## CDI / FDI status in the library (context for v2)

**Already in the library:**
- Address-space constants: `CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO
  = 0xFF` and `CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO = 0xFA`
  (`src/openlcb/defines.js`).
- Per-node declarations (`addressSpaceConfigurationDefinitionInfo`,
  `addressSpaceTrainFunctionDefinitionInfo` — `{ present, highestAddress }`).
- Server-side memory-config datagram + stream read/write, routed to a
  user-supplied `configMemoryRead/Write` callback.

**Not yet in the library:**
- No CDI XML generator or parser.
- No FDI XML generator or parser.
- No **client**-side memory-config read (to fetch CDI/FDI from a remote
  node). `ProtocolConfigMemRead` responds to incoming reads; it does not
  initiate reads of another node.

**Implications for this CS and the throttle:**
- v1 on both sides ships without CDI/FDI interaction. Throttle uses
  hardcoded F0–F28 labels; CS does not publish FDI per train.
- v2 in the library: add a client `readRemoteMemory(node, dest, space,
  offset, length)` API, plus small CDI/FDI XML helpers.
- v2 in this CS: when a train is allocated, build an FDI XML blob
  describing F0–F28 with DCC convention defaults (Head/Bell/Horn/…) or
  from a per-address roster overlay, and serve it via `configMemoryRead`
  on space 0xFA.
- v2 in the throttle: on controller-assign, read the assigned train's
  FDI and render richer function tiles.

---

## Operational vs debug flows

| Capability                | Flow                                                                          |
|---------------------------|-------------------------------------------------------------------------------|
| Normal throttle selects   | Throttle sends Train-Search with Allocate flag → library fires                |
| a DCC address             | `onTrainSearchNoMatch` → CS allocates virtual train node → library emits      |
|                           | `Producer Identified` → throttle proceeds to assign.                          |
| Debug: pre-create train   | "Add Train" form (below) instantiates without waiting for a search.           |
| Remove train              | Operator action in roster; sends nothing special — node is just deallocated.  |
| Force local EStop         | Operator action; drives the mock track but does not send over OpenLCB.        |
| Global emergency          | CS originates PCERs on the four well-known events; library delivers them to   |
|                           | all its own train nodes so `onTrainEmergencyEntered` fires locally too.       |

---

## Open questions / to verify before coding

1. **`PSI_TRAIN_CONTROL` flag name.** Verify the exact
   `defines.PSI_*` constant for the Train Control Protocol bit before
   writing the `protocolSupport` mask.
2. **Search 200ms debounce.** Confirm
   `ProtocolTrainSearchHandler.handleSearchNoMatch` is invoked only after
   the full node enumeration (so the 200ms TrainSearchS §6.2 wait is
   either naturally satisfied or needs an explicit timer in the CS
   callback).
3. **Node ID block registration.** A production CS would use a proper
   OpenLCB-assigned Node ID block. For the example, document that the
   default base ID is for demo use only.
4. **Roster-on-startup.** Decide whether the CS pre-allocates trains at
   connect time (from a config) or only lazily on throttle search. v1:
   user adds via the UI + Allocate-on-search. No config persistence.

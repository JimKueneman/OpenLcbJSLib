# OpenLcbJSLib — Phase 2 API Design

**Status:** Approved design, pre-implementation.
**Context:** OpenLcbJSLib is being rewritten as a thin JS layer over the
OpenLcbCLib WASM build. The pre-existing pure-JS port (`src/openlcb/*`,
`src/protocol/*`, `src/drivers/can/*` — 37 files) will be deleted. This
document captures the approved public API for the replacement.

**Companion material:**
- `examples/basic_node/PLAN.md`, `examples/train_throttle/PLAN.md`,
  `examples/train_command_station/PLAN.md` — intent reference (API bits in
  those docs reflect the legacy stack).
- `OpenLcbCLib/wasm/README.md` — the WASM ABI this design wraps.

---

## Design axioms

1. **One source of truth.** All protocol logic, all codecs, all constants
   come from OpenLcbCLib via WASM. No parallel JS implementations.
2. **Thin wrapper, idiomatic JS.** The WASM ABI is shaped around C; the
   JS surface is shaped around JS (classes, Promises, typed errors,
   `BigInt` node/event IDs).
3. **No backward compatibility.** Examples and tests are rewritten
   against the new API. Clean slate.
4. **No internal buffering / queueing.** Transport busy = throw. Caller
   owns retry policy.
5. **Discoverability beats minimalism.** Protocol methods live in
   namespaced sub-objects (`node.train.*`) so IDE completion is useful.

---

## 1. Top-level shape — two classes

```
OpenLcb              // runtime — owns WASM instance + transport
  └── createNode()   // returns →
OpenLcbNode          // per-node handle — owns a 48-bit node ID
```

- `OpenLcb` methods: `start()`, `stop()`, `createNode()`, plus runtime
  callbacks (transport events, `on100msTimer`).
- `OpenLcbNode` methods: `sendPcer()`, `registerConsumer()`, etc. —
  everything the WASM ABI takes a node ID for.
- Per-node callbacks attach to the node handle, not the runtime.

Matches the WASM ABI's transport-vs-node-scoped split exactly, and makes
multi-node consumers (e.g. the command-station example with a CS node +
N train nodes) route callbacks to the right node automatically.

---

## 2. Bootstrapping + lifecycle

**Async factory.** Constructor is private. WASM loading is inherently
async; pretending otherwise forces every subsequent method to either
queue or throw.

```js
const openlcb = await OpenLcb.create({
    transport: new WebSocketTransport({ url: 'ws://...' }),
    callbacks: {
        onTransportConnect:    () => {},
        onTransportDisconnect: (clean, code) => {},
        onTransportError:      (err) => {},
        on100msTimer:          () => {},
    },
});

const node = openlcb.createNode(0x050101010700n, params, nodeCallbacks);

await openlcb.start();    // resolves when transport is open
// … nodes log in in the background …
await node.loginComplete; // resolves when THIS node is logged in

await openlcb.stop();     // resolves when transport is closed
```

Contracts:
- `OpenLcb.create()` — async, returns a fully-initialized runtime.
  Rejects on WASM load failure.
- `createNode()` — sync. Returns an `OpenLcbNode` immediately. Login
  happens when both (a) the node exists and (b) the transport is open.
- `start()` — resolves when transport opens (not when nodes log in).
- `stop()` — resolves when transport is fully closed. Node handles stay
  valid but dormant until `start()` again. (OpenLCB has no node-destroy.)
- `configMemoryRead` / `configMemoryWrite` — per-node callbacks passed
  to `createNode()`, not to the runtime.

---

## 3. `OpenLcbNode` surface

```js
const node = openlcb.createNode(0x050101010700n, {
    // Parameters — only set what differs from defaults.
    protocolSupport: [PSI.EVENT_EXCHANGE, PSI.SIMPLE_NODE_INFORMATION],
    snip: { name: 'My Node', model: 'Basic', hardwareVersion: '1.0',
            softwareVersion: '0.1', userVersion: 1 },
    // addressSpace* keys default to absent. Override only what's used.
    // configurationOptions defaults to {}.
}, {
    // Callbacks — flat bag, node is always first argument.
    onLoginComplete:           (node) => {},
    onPcEventReport:           (node, eventId) => {},
    onConsumedEventIdentified: (node, idx, eventId, status) => {},
    onTrainSpeedChanged:       (node, speedF16) => {},
    onBroadcastTimeChanged:    (node, clockId, hour, minute) => {},
    onConfigMemRead:           (node, addr, count, buf) => count,
    onConfigMemWrite:          (node, addr, bytes) => bytes.length,
    // …etc
});

// Generic event ops at top level.
node.sendPcer(eventId);
node.sendEventWithMti(eventId, mti);
node.sendInitializationEvent();
node.registerConsumer(eventId);
node.registerProducer(eventId);
node.clearConsumers();
node.clearProducers();
node.registerConsumerRange(baseEventId, EventRangeCount.SPAN_256);
node.registerProducerRange(baseEventId, EventRangeCount.SPAN_256);
node.clearConsumerRanges();
node.clearProducerRanges();

// Node-scoped queries.
node.isProducerEventAssigned(eventId);   // → index or null
node.isConsumerEventAssigned(eventId);
node.isEventInProducerRanges(eventId);   // → boolean
node.isEventInConsumerRanges(eventId);

// Sub-protocol methods — namespaced.
node.train.sendSetSpeed(trainAlias, trainId, speedF16);
node.train.sendSetFunction(trainAlias, trainId, fnAddr, value);
node.train.sendEmergencyStop(trainAlias, trainId);
node.train.sendAssignController(trainAlias, trainId);
node.train.sendReleaseController(trainAlias, trainId);
node.train.setDccAddress(addr, isLong);
node.train.setSpeedSteps(steps);

node.broadcastTime.setupConsumer(clockId);
node.broadcastTime.setupProducer(clockId);
node.broadcastTime.start(clockId);
node.broadcastTime.stop(clockId);
node.broadcastTime.sendReportTime(clockId, hour, minute);

// Properties.
node.id;            // BigInt
node.parameters;    // resolved parameters object
node.loginComplete; // Promise<OpenLcbNode>
```

Decisions:
- **Flat callbacks bag, not EventTarget.** Single declaration site, no
  listener-cleanup juggling. Grep-friendly.
- **`loginComplete` Promise in addition to callback.** `await` is the
  common case; callback is for consumers who want both.
- **Sub-protocol method namespacing** (`node.train.*`) keeps top-level
  surface manageable and mirrors the OpenLcbCLib module structure.
- **Sub-protocol callbacks stay flat** (`onTrainSpeedChanged`, not
  `{ train: { onSpeedChanged } }`) — shorter, more grep-friendly.
- **Simplified parameters** — `addressSpace*` keys default to absent;
  `configurationOptions` defaults to `{}`; `protocolSupport` is an
  array of named constants (wrapper splits into low/high internally).
- **`ProtocolNotSupportedError` if sub-protocol accessed without
  opt-in.** E.g. `node.train.sendSetSpeed(...)` when the node's
  `protocolSupport` doesn't include `PSI.TRAIN_CONTROL`.

---

## 4. Error model — throw typed errors

```js
class OpenLcbError             extends Error {}
class UnknownNodeError         extends OpenLcbError {}   // WASM -3
class InvalidArgumentError     extends OpenLcbError {}   // WASM -1
class PoolFullError            extends OpenLcbError {}   // WASM -2
class TransportBusyError       extends OpenLcbError {}   // WASM -4
class NotInitializedError      extends OpenLcbError {}   // WASM -5
class ProtocolNotSupportedError extends OpenLcbError {}  // node.train when PSI.TRAIN_CONTROL not set
```

- Success methods return `void` (fire-and-forget sends) or meaningful
  values (`node.registerConsumer` returns the index).
- Programming bugs (`UnknownNodeError`, `InvalidArgumentError`,
  `ProtocolNotSupportedError`) bubble up unless caught — they indicate
  caller bugs.
- Runtime conditions (`TransportBusyError`, `PoolFullError`) are typed
  for retry.
- Async methods reject with the same error types.

Usage:

```js
try {
    node.sendPcer(eventId);
} catch (e) {
    if (e instanceof TransportBusyError) {
        setTimeout(() => node.sendPcer(eventId), 10);
    } else {
        throw e;
    }
}
```

No queue-and-backpressure layer. Callers know their retry policy better
than the library does (drop / retry-once / buffer forever).

---

## 5. Pure helpers + constants

**Stateless codecs** — on the runtime (they need WASM loaded):

```js
openlcb.float16.fromFloat(mps);            // → u16 bit pattern
openlcb.float16.toFloat(half);
openlcb.float16.speedWithDirection(mps, reverse);
openlcb.float16.getSpeed(half);
openlcb.float16.getDirection(half);
openlcb.float16.isNaN(half);
openlcb.float16.isZero(half);
openlcb.float16.negate(half);

openlcb.broadcastTime.createTimeEventId(clockId, h, m, isSet);
openlcb.broadcastTime.createDateEventId(clockId, month, day, isSet);
openlcb.broadcastTime.createYearEventId(clockId, year, isSet);
openlcb.broadcastTime.createRateEventId(clockId, rateFixed, isSet);
openlcb.broadcastTime.createCommandEventId(clockId, commandEnum);
openlcb.broadcastTime.extractClockId(eventId);
openlcb.broadcastTime.extractTime(eventId);
openlcb.broadcastTime.extractDate(eventId);
openlcb.broadcastTime.extractYear(eventId);
openlcb.broadcastTime.extractRate(eventId);   // → signed int16 or null
openlcb.broadcastTime.getEventType(eventId);
openlcb.broadcastTime.isTimeEvent(eventId);
openlcb.broadcastTime.makeClockId(unique48);

openlcb.dccDetector.encodeEventId(detectorId, direction, rawAddr14);
openlcb.dccDetector.makeShortAddress(shortAddr);
openlcb.dccDetector.makeConsistAddress(consistAddr);
openlcb.dccDetector.extractDirection(eventId);
openlcb.dccDetector.extractAddressType(eventId);
openlcb.dccDetector.extractRawAddress(eventId);
openlcb.dccDetector.extractDccAddress(eventId);
openlcb.dccDetector.extractDetectorId(eventId);
openlcb.dccDetector.isTrackEmpty(eventId);

openlcb.trainSearch.createEventId(dccAddr, flags);
openlcb.trainSearch.extractDigits(eventId);      // → Uint8Array[6]
openlcb.trainSearch.digitsToAddress(digits);
openlcb.trainSearch.extractFlags(eventId);
openlcb.trainSearch.isSearchEvent(eventId);

openlcb.util.generateEventRangeId(baseEventId, countEnum);
```

**Constants** — namespaced, top-level:

```js
import {
    PSI, MTI, AddressSpace, EventRangeCount, EventStatus,
    TrainEmergencyType, BroadcastTimeEventType,
    DccDetectorDirection, DccDetectorAddressType,
    TrainSearchFlag,
} from 'openlcb-js-lib';
```

Backed by `wasm/openlcb-defines.mjs`. Enum types not yet covered by the
CLib codegen scan (noted in `wasm/README.md`) — close that gap in
OpenLcbCLib, don't maintain a parallel JS constants file.

---

## 6. Transport interface

```js
class Transport {
    async connect();               // resolves when open
    async disconnect();            // resolves when closed
    send(gridconnectFrame);        // throws TransportBusyError when full

    // Runtime sets these at construction. Consumer never touches.
    onMessage;      // (frame: string) => void
    onError;        // (err: Error) => void
    onStateChange;  // ('connected'|'connecting'|'disconnected') => void
}
```

Shipped:
- `WebSocketTransport` — browser + Node (via `ws` package for the
  latter, pluggable via `WebSocketImpl` option).
- `TcpGridConnectTransport` — Node only, for the conformance harness.

Reconnect logic lives inside the transport, not the runtime. Consumers
who need different reconnect policy either configure the transport or
subclass / write their own.

```js
const transport = new WebSocketTransport({
    url: 'ws://localhost:12022/',
    autoReconnect: true,
    WebSocketImpl: globalThis.WebSocket,
});
```

---

## 7. Package layout

```
src/
  index.js                   // public entry — single source of exports
  openlcb/                   // (renamed from wrapper/)
    runtime.js               // OpenLcb class
    node.js                  // OpenLcbNode class
    errors.js                // typed error classes
    constants.js             // groups wasm/openlcb-defines.mjs into PSI/MTI/etc.
    internals/
      wasm-bootstrap.js      // async WASM factory + cwrap wiring
      callbacks.js           // Module.onX → per-node callback routing
      params.js              // createNode() parameter defaults + validation
  drivers/
    websocket/transport.js
    tcp/transport.js         // (new — Node-only)
  storage/
    localstorage-config-memory.js
    file-config-memory.js
wasm/
  openlcb-core.{wasm,mjs}    // from OpenLcbCLib build
  openlcb-defines.mjs
  VERSION
```

`src/index.js` — single place consumers import from:

```js
export { OpenLcb } from './openlcb/runtime.js';
export {
    OpenLcbError, UnknownNodeError, InvalidArgumentError,
    PoolFullError, TransportBusyError, NotInitializedError,
    ProtocolNotSupportedError,
} from './openlcb/errors.js';
export {
    PSI, MTI, AddressSpace, EventRangeCount, EventStatus,
    TrainEmergencyType, BroadcastTimeEventType,
    DccDetectorDirection, DccDetectorAddressType,
    TrainSearchFlag,
} from './openlcb/constants.js';
export { WebSocketTransport }      from './drivers/websocket/transport.js';
export { TcpGridConnectTransport } from './drivers/tcp/transport.js';
export { LocalStorageConfigMemory } from './storage/localstorage-config-memory.js';
// FileConfigMemory NOT re-exported (Node-only; import directly).
```

---

## Deferred / open

Small items to lock down during implementation (Phase 4):

1. **Config-memory callback signature.** `onConfigMemRead(node, addr,
   count, buf)` — `buf` as `Uint8Array` view of WASM heap, returning
   bytes-written. Matches WASM ABI. Confirm during implementation.
2. **SNIP field names.** `mfgVersion`, `hardwareVersion`, etc. — camelCase
   mapping of C struct fields. Lock when writing `params.js`.
3. **`registerConsumer` return.** Currently "index or null" — confirm
   `null` (JS-idiomatic) vs `-1` (C-native).
4. **`on100msTimer` cadence.** Consumer must still call `tick()` every
   100 ms, or does the runtime schedule its own interval? Leaning
   toward runtime-scheduled for ergonomics; expose `tickInterval`
   option to disable for test determinism.
5. **Stream callbacks** (`onStreamInitiateRequest`, etc.). Observe-only
   per the WASM README. Wire them verbatim into the callbacks bag.
6. **Enum-value codegen gap.** `openlcb_types.h` enums aren't in the
   CLib codegen scan. Fix there, not with a parallel JS file.
7. **Node parameters schema.** Whether to validate strictly at
   `createNode()` time (throw `InvalidArgumentError`) vs pass through
   to WASM and let it error. Leaning strict, with clear messages.

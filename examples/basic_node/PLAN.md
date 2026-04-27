# Basic Node Example — Plan

> **Banner — historical design doc.** API references in the body of this
> file reflect the pre-WASM legacy pure-JS stack. The example has since
> shipped against the new `OpenLcb.create()` / `node.sendPcer()` API; see
> [basic-node.html](basic-node.html) for the current source of truth.
> The CDI file referenced below as `cdi.xml` is now
> [cdi_basic_websocket_node.xml](cdi_basic_websocket_node.xml). The
> design intent (scope, what it demonstrates, UX) is still accurate.

Smallest-possible working OpenLCB node in a browser. One virtual node, Event
Exchange + SNIP only, connected to a GridConnect WebSocket hub. Intended as
the "hello world" reference for the library API.

---

## Status

- [x] UI scaffold (Connect form, event sender, log).
- [x] Working against the legacy pure-JS stack.
- [x] Port to the WASM wrapper API — shipped; uses `OpenLcb.create()`,
  per-node `loginComplete` Promise, `LocalStorageConfigMemory`, and
  `openlcb.reboot()` for Memory Configuration Reset/Reboot.

---

## What it demonstrates

1. Connect to a GridConnect WebSocket (JMRI, an OpenLCB hub, etc.).
2. Allocate one virtual node with a caller-supplied 48-bit Node ID.
3. Log the login handshake and the first `Initialization Complete`.
4. Send a user-supplied PC Event Report from that node.
5. Receive and log incoming PCERs and consumer-identified events on the bus.

That's the entire scope — no memory config, no train, no broadcast time. If a
consumer application needs more than this, the throttle and command-station
examples pick it up.

---

## UI structure

Single page, three stacked sections (no routing, no card stack):

1. **Connect form**
   - WebSocket URL input
   - Node ID input (hex)
   - Consumer count (autocreate, 0–255)
   - Producer count (autocreate, 0–255)
   - Connect / Disconnect buttons
   - Connection state indicator (disconnected / connecting / connected)
2. **Event sender**
   - Event ID input (16 hex chars)
   - Send PC Event Report button (disabled until connected + logged in)
3. **Log panel**
   - Scrolling monospaced text, timestamp per line
   - Captures: transport events, login completion, PCERs in/out, consumed
     events

Plain desktop styling. No mobile concessions, no theme switcher. The point
is to be the minimum viable example, not a polished UX.

---

## Interaction flow

1. User fills in URL + Node ID, clicks **Connect**.
2. Page creates the config, allocates the node, starts the transport.
3. Transport opens → login runs → `onLoginComplete` fires → **Send** button
   unlocks.
4. User types an Event ID, clicks **Send** → `sendEventPcReport` →
   gridconnect frame on the wire.
5. Any incoming PCER on the wire → logged. Any Consumer Identified matching
   a registered consumer → logged with status.
6. User clicks **Disconnect** → `stop()` → transport closes → state resets.

No persistence. Refresh loses everything, including the node identity, by
design (it's a demo).

---

## Library surface used (to be redesigned in clean-slate rewrite)

Legacy surface referenced today — listed only so the rewrite has a target
shape to match or consciously replace:

| Need                       | Legacy API                                             |
|----------------------------|--------------------------------------------------------|
| Config + transport         | `new OpenLcbConfig({ websocketUrl, callbacks, … })`    |
| Allocate node              | `config.createNode(id, params)`                        |
| Start / stop               | `config.start()` / `config.stop()`                     |
| Send PCER                  | `config.application.sendEventPcReport(node, eventId)`  |
| Login complete             | `callbacks.onLoginComplete(node)`                      |
| Incoming PCER              | `callbacks.onPcEventReport(node, eventId)`             |
| Matched consumer event     | `callbacks.onConsumedEventIdentified(node, idx, evt, status)` |
| Transport lifecycle        | `onTransportConnect / onTransportDisconnect / onTransportError` |
| Config memory backing      | `configMemoryRead / configMemoryWrite` callbacks       |
| Protocol / constants       | `defines.PSI_EVENT_EXCHANGE`, `defines.PSI_SIMPLE_NODE_INFORMATION`, `defines.OPENLCB_JS_LIB_VERSION` |

Notable implicit contracts to preserve in the rewrite:
- `createNode` accepts a `BigInt` node ID.
- `snip` block: `{ mfgVersion, name, model, hardwareVersion, softwareVersion, userVersion }`.
- Full `addressSpace*` block in node parameters even when all `present: false`
  (current API requires every key; consider making them optional).
- PCER send accepts `BigInt` event IDs.
- Event IDs in callbacks come back as `BigInt`.

---

## Node parameters (reference)

Current minimum — Event Exchange + SNIP only:

```js
{
    protocolSupport: defines.PSI_EVENT_EXCHANGE | defines.PSI_SIMPLE_NODE_INFORMATION,
    consumerCountAutocreate: <0..255>,
    producerCountAutocreate: <0..255>,
    snip: {
        mfgVersion: 4,
        name: 'OpenLcbJSLib',
        model: 'Basic Node',
        hardwareVersion: '1.0',
        softwareVersion: defines.OPENLCB_JS_LIB_VERSION,
        userVersion: 2,
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
}
```

Config memory is stubbed (`read → zeros`, `write → accept`) — the example
doesn't persist anything. Real persistence belongs in the throttle / CS
examples or in a consumer app.

---

## Files

- `basic-node.html` — single-page UI + wiring. Served statically; no
  bundler required (pulls the ES modules directly).
- `openlcb.bundle.js` — legacy bundle, unused by `basic-node.html` in its
  current form. Kept for parity with the other examples. Regenerated by
  `npm run build`.
- `PLAN.md` — this file.

---

## Running

```
python3 -m http.server 8766   # from repo root
# then open http://localhost:8766/examples/basic_node/basic-node.html
```

Point the WebSocket URL at a running GridConnect hub (JMRI default:
`ws://localhost:12022/`).

---

## Open questions for the rewrite

1. **Should the `addressSpace*` keys be optional?** Every example currently
   spells out all eight with `{ present: false, highestAddress: 0 }`. The new
   API could default them to absent.
2. **Should `createNode` return a plain `{ id }` or a rich object?** The
   example only reads `node.id` — a bare handle is enough here. The
   throttle and CS examples may need more.
3. **Consumer / producer autocreate still relevant?** The old model
   allocated unnamed slots with `*CountAutocreate`. With WASM-side pools,
   verify this still maps to something meaningful.
4. **`onLoginComplete` returning `true`** — legacy contract was "return
   true to accept"; confirm the new API keeps or drops that.

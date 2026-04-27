# Train Throttle Example — Plan

> **Banner — historical design doc.** API references in the body of
> this file (`config.applicationTrain.*`, `defines.PSI_*`, etc.) reflect
> the pre-WASM legacy stack and DO NOT match shipped code. The throttle
> has since shipped against the new WASM wrapper API — see
> [throttle.html](throttle.html) / [throttle.js](throttle.js) for the
> current source of truth, and
> [../../documentation/train_protocol_gap_analysis.md](../../documentation/train_protocol_gap_analysis.md)
> for what is and isn't yet covered. Files now shipped:
> `throttle.{html,js,css}`, `cdi_throttle.xml`, `register_events.js`,
> `throttle_project.json`, `openlcb_user_config.js`, `openlcb.bundle.js`,
> `GETTING_STARTED.txt`. The design intent (protocol flow, scope) below
> is still useful as background.

Mobile-first throttle webpage for OpenLCB, standalone (no shared JS with
`basic_node`), talking to a GridConnect WebSocket hub. Follows
**TrainControlS**, **TrainSearchS**, and **FunctionDescriptionInformationS**.

---

## Status

The original line items below were tracked against the legacy pure-JS
stack. The throttle has since been re-implemented against the WASM
wrapper API and is described as functional;
[../../documentation/train_protocol_gap_analysis.md](../../documentation/train_protocol_gap_analysis.md)
is the current authoritative status of train-protocol coverage.

- [x] UI mockup (`throttle.html`) with fake data, no library wiring.
- [x] Library wiring (search → assign → drive → release) — uses the
      runtime-level `onTrainSearchReply` callback (replaces the legacy
      `onProducerIdentifiedSet` route referenced in the body of this doc).
- [ ] Heartbeat response. *(see gap analysis for current coverage)*
- [ ] Layout-wide emergency PCERs + inbound emergency display.
- [ ] FDI (0xFA) XML download for per-train function labels. *(deferred v2)*
- [ ] Consisting (listener attach/detach). *(deferred v2)*

---

## Protocol flow (per specs)

1. **Enumerate trains**
   - Throttle sends *Identify Producer* with a Train-Search event ID
     (`09.00.99.FF.qq.qq.qq.rr`), or with the `Is Train`
     well-known event (`01.01.00.00.00.00.03.03`).
   - Each matching Train Node replies with *Producer Identified
     Valid/Invalid/Unknown* carrying the same event ID.
   - **The train's identity is the `sourceId/sourceAlias` of that reply.**
     (See Library Gap #1.)

2. **Assign controller** — `sendAssignController(throttle, trainAlias, trainId)`.
   Train replies with a Train Control Reply (`MTI 0x01E9`, subtype
   Controller Config Reply `0x01`) carrying a Result byte.
   Library fires `onControllerAssignReply(node, result, current)`.
   - Result `0` = OK.
   - Non-zero = failed; bit 0 = assigned controller refused, bit 1 = train
     refused. (TrainControlS §4.4)

3. **Drive**
   - `sendSetSpeed(throttle, alias, id, float16)` — speed is **scale-m/s**,
     not mph. Sign bit = direction. (TrainControlTN §4.1)
   - `sendSetFunction(throttle, alias, id, fnAddr, value)` — addr in 0xF9
     space; binary functions: `0`=off, non-zero=on.
   - `sendEmergencyStop(throttle, alias, id)` — train-local E-stop.
   - `sendQuerySpeeds` / `sendQueryFunction` to hydrate UI after assign.

4. **Heartbeat** — train may send a Heartbeat Request
   (Train Control Management / Heartbeat Request `0x40 / 0x03`) with a
   timeout in seconds. Library fires `onHeartbeatRequest(node, timeoutSecs)`.
   Throttle must reply with any command/query or `sendNoop` before the
   deadline. Spec default: 10s period, 3s deadline.
   Alerter-mode (require user ack) deferred.

5. **Layout emergency** — PCER on four well-known events:
   | Event                          | Meaning                   |
   |--------------------------------|---------------------------|
   | `01.00.00.00.00.00.FF.FD`      | Emergency Stop All        |
   | `01.00.00.00.00.00.FF.FC`      | Clear Emergency Stop All  |
   | `01.00.00.00.00.00.FF.FF`      | Emergency Off All         |
   | `01.00.00.00.00.00.FF.FE`      | Clear Emergency Off All   |

   Incoming emergency is surfaced via `onTrainEmergencyEntered/Exited`.

6. **Release** — `sendReleaseController` on train-deselect and on disconnect
   (spec requires release on intentional shutdown, §6.1).

---

## Speed encoding

- Wire format: IEEE 754 half-precision float (float16) in **scale meters per
  second**. Example: `0x5640` = 100 scale-m/s ≈ 223 mph ≈ 360 km/h.
- Sign bit = direction; signed zero distinguishes stopped-forward vs
  stopped-reverse.
- Throttle display unit is user-selectable (mph/km/h/m/s). Internal value
  always float16 m/s.
- **Speed steps** (14/28/128):
  - Used in the search event flag bits (TrainSearchS §5.2 Table 4).
  - Used in the throttle UI to quantize slider detents and show "step N/M".
  - Do **not** change the wire encoding — the train is still driven with a
    float16 m/s value corresponding to the quantized step.
- Default top speed: **126 mph** (pragmatic DCC default from
  TrainControlTN §4.1; 1 mph ≈ 1 speed step at 128-step mode).

---

## Library surface used

| Need                            | API                                                             |
|---------------------------------|-----------------------------------------------------------------|
| Transport                       | `OpenLcbConfig({ websocketUrl, callbacks, ... })`               |
| Our throttle node               | `config.createNode(id, params)`                                 |
| Train-search PCER               | `config.application.sendEventPcReport(node, eventId)`           |
| Search event ID                 | `OpenLCB.trainSearchCreateEventId(address, flags)` + flag consts |
| Throttle commands               | `config.applicationTrain.sendAssignController / sendReleaseController / sendSetSpeed / sendSetFunction / sendEmergencyStop / sendQuerySpeeds / sendQueryFunction / sendNoop` |
| Float16                         | `OpenLCB.float16.*`                                             |
| Search-result reply             | `callbacks.onProducerIdentifiedSet` (see Gap #1)                |
| Assign result                   | `callbacks.onControllerAssignReply(node, result, current)`      |
| Speed / function feedback       | `callbacks.onTrainSpeedChanged` / `onTrainFunctionChanged`      |
| Layout emergency                | `callbacks.onTrainEmergencyEntered/Exited`                      |
| Heartbeat request from train    | `callbacks.onHeartbeatRequest(node, timeoutSecs)`               |

---

## Open questions

### Gap #1 — Producer Identified source node (load-bearing, deferred)

`onProducerIdentifiedSet(node, eventId)` drops the train's `sourceId` /
`sourceAlias`. The throttle cannot address commands to a train whose node
ID it doesn't know. Source IS present in `sm.incoming.msg` but not passed
through.

**Decision needed.** Options:

- **A.** Extend the callback signature to `(node, eventId, sourceId,
  sourceAlias)`. One-line edit in `src/protocol/event-transport.js`,
  backward-compatible. Cleanest.
- **B.** Add a generic "raw incoming OpenLCB message" observer on
  `OpenLcbConfig`.
- **C.** Work around it in the example only by monkey-patching internals.
  Not recommended.

Currently deferred — UI mockup first, revisit when wiring.

### Question #2 — consisting in v1?

Listener Attach/Detach/Query (0x30 subcommands) is in TrainControlS §6.5.
Default: **skip for v1**, add a single "Add listener by Node ID" row in v2.

### Question #3 — FDI in v1?

Each Train Node may expose an FDI XML at memory space 0xFA describing
function labels (binary/momentary/analog, names, icons).
Default: **skip for v1**, use hardcoded F0–F28 labels. Add memory-config
read in v2.

### Question #4 — top-speed configurability

Default 126 mph. Expose a settings dialog later; for v1 it's hardcoded.

---

## Files

- `throttle.html` — single-page UI. Currently pure mockup with fake data.
  Will import `openlcb.bundle.js` once wiring starts.
- `openlcb.bundle.js` — copy of `dist/openlcb.bundle.js` (same pattern
  as `examples/basic_node/`). Present and committed.

---

## UI structure

Card-stack, one screen visible at a time:

1. **Connect** — WebSocket URL, throttle Node ID, Connect/Disconnect.
2. **Roster** — search input + flag chips (DCC / Long / Exact / Addr-only /
   Allocate) + step-mode chips (14 / 28 / 128), results list.
3. **Throttle** — vertical speed slider with readout (configurable unit),
   FWD/REV, E-STOP, F0–F28 grid, alerter dot, Release, layout-emergency
   drawer.

Dark theme, cyan accent, mobile-first (max-width 480px, safe-area insets).

# WASM ⇄ JS wrapper style guide

This document fixes the conventions used when exposing an OpenLcbCLib C API
through Emscripten to the JS wrapper and, from there, to consumer
applications.  It is also the spec the coverage audit
(`tools/audit-wasm-coverage.mjs`) enforces — any deviation must either
comply or be listed in the audit-ignore file with a reason.

There are three boundaries.  Each has one naming rule and a small set of
marshalling rules.

---

## 1. C API → WASM export

Every user-facing C API declared in
`OpenLcbCLib/src/openlcb/openlcb_application*.h` SHOULD be exposed as a
WASM export unless explicitly listed as intentionally out-of-scope (see §4).

**Naming.**  `OpenLcb<Module>_<action>` becomes `wasm_<module_token>_<action>`.

Module tokens are fixed — no ad-hoc abbreviations outside this table.

| C module                        | Token            |
|---------------------------------|------------------|
| `OpenLcbApplication`            | (empty)          |
| `OpenLcbApplicationTrain`       | `train`          |
| `OpenLcbApplicationBroadcastTime` | `bt`           |
| `OpenLcbApplicationDccDetector` | `dcc`            |

Examples:

| C API                                               | WASM export                  |
|-----------------------------------------------------|------------------------------|
| `OpenLcbApplication_send_event_pc_report`           | `wasm_send_event_pc_report`  |
| `OpenLcbApplicationTrain_setup`                     | `wasm_train_setup`           |
| `OpenLcbApplicationBroadcastTime_send_report_time`  | `wasm_bt_send_report_time`   |
| `OpenLcbApplicationDccDetector_make_short_address`  | `wasm_dcc_make_short_address`|

**Node ID arguments** are always `uint64_t` on the C side and are declared
as `bigint` in the JS `cwrap` signature.  Never split the node ID into
two `uint32_t`s across an export — only across callbacks (see §3).

**Return codes.**  Functions that can fail return `int32_t`; `0` =
`WASM_OK`, negative values map to `WASM_ERR_*`.  Pure getters return the
value directly (`wasm_train_get_dcc_address` → `int32_t` address or
`WASM_ERR_UNKNOWN_NODE`).  Boolean tests return `0` / `1`.

---

## 1b. WASM-only entry points

Some exports exist on the WASM boundary that have no direct C API
counterpart — they're constructed on the WASM side to bridge an
impedance mismatch between C structures and JS marshalling.  These do
NOT need to appear in the §1 mapping table.

**Lifecycle.**  Called by the JS wrapper to drive the library.

| Export                  | Purpose                                            |
|-------------------------|----------------------------------------------------|
| `wasm_initialize`       | One-time CAN + OpenLCB stack bring-up. Idempotent. |
| `wasm_run`              | One pass of the main state machine.                |
| `wasm_100ms_tick`       | Advance the global 100 ms counter.                 |

**Transport entry.**  Incoming gridconnect text from the WebSocket.

| Export                  | Purpose                                            |
|-------------------------|----------------------------------------------------|
| `wasm_rx_gridconnect`   | Feed one or more `:X...;` frames into the RX path. |

**Node builder.**  Replaces passing a C `node_parameters_t` struct across
the boundary; each setter stages a field, `wasm_create_node` commits.

| Export                        | Purpose                                        |
|-------------------------------|------------------------------------------------|
| `wasm_node_builder_reset`     | Zero the scratch; free any staged CDI/FDI.    |
| `wasm_node_set_snip`          | Stage SNIP strings + versions.                 |
| `wasm_node_set_protocol_support` | Stage the 64-bit PIP bitfield (low/high).   |
| `wasm_node_set_event_autocreate` | Stage producer/consumer auto-counts.        |
| `wasm_node_set_configuration_options` | Stage config-memory option flags.      |
| `wasm_node_set_address_space` | Stage one address-space record.                |
| `wasm_node_set_cdi` / `_fdi`  | Stage CDI / FDI XML bytes (copied on commit).  |
| `wasm_create_node`            | Commit the scratch and allocate the node.      |

The audit script (`tools/audit-wasm-coverage.mjs`) treats all of the
above as pre-authorized and does not look for a C-API counterpart.

---

## 2. WASM export → JS wrapper

Every WASM export SHOULD surface through the JS wrapper as a method on the
appropriate facade class.

**Facades mirror the C module layout** (see `src/wrapper/openlcb_application*.js`):

| C module                          | JS class                       | Config field                 |
|-----------------------------------|--------------------------------|------------------------------|
| `OpenLcbApplication`              | `OpenLcbApplication`           | `config.application`         |
| `OpenLcbApplicationTrain`         | `OpenLcbApplicationTrain`      | `config.applicationTrain`    |
| `OpenLcbApplicationBroadcastTime` | `OpenLcbApplicationBroadcastTime` | `config.applicationBroadcastTime` |
| `OpenLcbApplicationDccDetector`   | `OpenLcbApplicationDccDetector`| `config.applicationDccDetector` |

**Naming.**  JS method names are camelCase regardless of the underlying
snake_case C/WASM name:

| WASM export                   | JS method                       |
|-------------------------------|---------------------------------|
| `wasm_train_setup`            | `applicationTrain.setup`        |
| `wasm_send_event_pc_report`   | `application.sendEventPcReport` |
| `wasm_bt_send_report_time`    | `applicationBroadcastTime.sendReportTime` |

**`cwrap` handle names** inside `OpenLcbConfig._buildApi()` are private
and MAY be short (`tAssign`, `sendPcer`, `btReportTime`) to keep the
builder legible.  Consumer-facing methods never use these shortenings.

**Argument marshalling.**

- Node IDs: JS passes `bigint`; `cwrap` signature is `'bigint'`.
- Event IDs: same as node IDs — `bigint` in, `bigint` out.
- Aliases: `number` (a 12-bit value).  `alias | 0` before handing to `cwrap`.
- Enums (event_status, train_emergency_type, speed_step_mode): plain
  `number`, matching the integer values declared in
  `src/openlcb/openlcb_types.h`.  If the wrapper defines JS-side enum
  mirrors they live in `src/openlcb/defines.js`, keyed to the same
  numeric values.
- Byte buffers: `Uint8Array`.  The wrapper copies between JS and
  `Module.HEAPU8` inside the facade method; consumers never see heap
  pointers.

**Return value handling.**

- `WASM_OK` / `0` → method returns `true`.
- `WASM_ERR_*` → method returns `false`.  Consumers wanting the raw code
  can call the underlying `config._api.<handle>(...)` if needed (private
  escape hatch).
- Getters return the value directly; `-1` means "not found" and is
  preserved.

---

## 3. C callback → JS `Module.on<Event>` hook

Every `interface_openlcb_*_t` field in the C library is a function
pointer invoked by the library when something happens.  Each one MUST be
wired to a JS `Module.on<Event>` hook via `EM_ASM`, OR it MUST be
explicitly tagged as an internal stub (§4).

**Naming.**  `on_<event>` C field → `Module.on<Event>` JS hook
(camelCase, `on` prefix).  Example: `.on_train_search_matched` →
`Module.onTrainSearchMatched`.

**Standard trampoline shape.**

```c
static void _on_some_event(openlcb_node_t *node, int arg)
{
    EM_ASM({
        if (Module.onSomeEvent) {
            var nid = BigInt($0) | (BigInt($1) << 32n);
            Module.onSomeEvent(nid, $2);
        }
    }, (uint32_t) (node->id & 0xFFFFFFFFu),
       (uint32_t) ((node->id >> 32) & 0xFFFFu),
       (int) arg);
}
```

The node ID is split into low/high 32-bit halves on the C side and
reassembled to a `BigInt` in JS.  Do not pass `uint64_t` directly to
`EM_ASM` — Emscripten does not marshal 64-bit ints through the macro.

**Boolean-returning hooks** use `EM_ASM_INT` and MUST have a default
(usually `return 1` = accept) so the library behaves sensibly when the
JS side provides no hook.

**JS-wrapper forwarding.**  The wrapper's `_ensureModule()` hooks install
each `Module.on*` hook to a private dispatcher that looks up the node
object from the registry and invokes the user-supplied callback:

```js
onTrainSpeedChanged: (nid, speed) => this._dispatchN1(cb.onTrainSpeedChanged, nid, speed),
```

Consumer callback names are identical to the `Module.on*` name —
`onTrainSpeedChanged`, not `onSpeedChanged` — so the JS wrapper adds no
naming layer on top of the CLib names for callbacks.  (Exports are
renamed to camelCase per §2; callbacks are not.)

---

## 4. What's NOT exposed

The following C APIs are intentionally out of scope and MUST NOT be
wrapped.  They exist for library internals, already have JS-native
equivalents, or don't make sense to call across the boundary.

- **Library plumbing.**  Anything under `openlcb_config`,
  `openlcb_buffer_*`, `openlcb_login_statemachine`,
  `openlcb_main_statemachine`, `openlcb_message_fifo`, etc.  These are
  called from inside the library; the lifecycle is driven by
  `wasm_initialize` / `wasm_run` / `wasm_100ms_tick`.
- **CAN driver plumbing.**  `CanTx*`, `CanRx*`, `CanLogin*`,
  `InternalNodeAliasTable`, `CanBufferFifo`.  Transport is gridconnect text over
  WebSocket; CAN framing lives entirely inside the WASM.
- **GridConnect codec.**  `OpenLcbGridConnect_*`.  Text goes across
  `Module.onGridconnectTx` / `wasm_rx_gridconnect`; the JS wrapper
  never parses or builds gridconnect strings itself.
- **Float16.**  `OpenLcbFloat16_*`.  A JS-native equivalent already
  ships at `src/openlcb/float16.js`; duplicating through WASM is
  strictly worse (allocates, crosses the boundary).
- **Utilities.**  `OpenLcbUtilities_*`, string helpers.  Use the
  equivalent JS idiom.

Any function added to an out-of-scope module is auto-excluded.
Exceptions require a one-line entry in `tools/audit-ignore.txt` with a
reason.

---

## 5. Audit contract

`tools/audit-wasm-coverage.mjs` produces three lists:

1. C API not surfaced as a WASM export.
2. Callback fields with no JS hook (stubbed functions).
3. WASM exports unused by any JS wrapper file.

**Every entry must either be fixed or appear in
`tools/audit-ignore.txt`** with the format:

```
<name>  # <one-line reason>
```

A clean audit (no unignored entries) is the merge gate for CLib
re-vendoring and wrapper changes.

---

## 6. Adding a new API — checklist

When adding an API that spans the boundary:

1. **C side** — declare `OpenLcb<Module>_<action>()` in the appropriate
   `openlcb_application*.h`, implement in `.c`.
2. **WASM binding** — add `wasm_<module_token>_<action>` to
   `wasm/bindings.c` using the `EMSCRIPTEN_KEEPALIVE` attribute;
   marshal args per §1; return `int32_t` status.
3. **WASM README** — document the export in `wasm/README.md`.
4. **JS cwrap** — add a handle to `OpenLcbConfig._buildApi()`.
5. **JS facade method** — add a camelCase method to the appropriate
   facade class.
6. **Audit** — run `node tools/audit-wasm-coverage.mjs`; confirm the
   new export appears in list (3) and gets removed once the facade
   method references it.  No other entries should have changed.

For a new callback:

1. **C side** — add the field to the matching `interface_openlcb_*_t`
   struct; document semantics.
2. **WASM binding** — add the EM_ASM trampoline per §3; install in the
   struct initializer in `bindings.c`.
3. **JS hooks** — add a forwarder in `_ensureModule()`.
4. **Audit** — re-run.  No new entries in list (2).

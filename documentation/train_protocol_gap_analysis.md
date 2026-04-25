# Train Search & Train Control — Gap Analysis

Status of the **TrainSearchS** and **TrainControlS** standards in the
two example apps (`examples/train_throttle/`, `examples/train_command_station/`)
and in the underlying `OpenLcbCLib` C library + WASM bindings.

- **Throttle / CS columns** — implemented in the example app (✅), partially
  implemented (partial), or absent (❌).
- **Recommendation** — what the example apps should add to exercise the gap.
- **CLib readiness** — whether the C library + WASM ABI already supports
  the recommendation (✅ ready), needs minor exposure work (⚠️), or has a
  real implementation gap (❌).

Spec references:
- `OpenLcb Documents/standards/TrainSearchS.pdf`
- `OpenLcb Documents/standards/TrainControlS.pdf`

CLib references (paths under `OpenLcbCLib/`):
- `src/openlcb/protocol_train_handler.c` / `.h`
- `src/openlcb/protocol_train_search_handler.c` / `.h`
- `src/openlcb/openlcb_application_train.c` / `.h`
- `src/openlcb/protocol_config_mem_read_handler.c` / `.h`
- `src/openlcb/openlcb_main_statemachine.c`
- `src/openlcb/openlcb_config.h` / `.c`

WASM binding references (paths under `OpenLcbJSLib/`):
- `src/openlcb/internals/wasm-api.js`
- `src/openlcb/node.js`

---

## A. TrainSearch (TrainSearchS)

| # | Spec feature | Throttle | CS | Recommendation | CLib readiness |
|---|---|---|---|---|---|
| A1 | Single numeric query, 6-nibble encode | ✅ | ✅ | — | ✅ ready |
| A2 | Allocate / Exact / Address-only flags | ✅ | ✅ | — | ✅ ready |
| A3 | Track-protocol selector (DCC, Native, MFX, MM v1/v2/v2ext, Any) | ✅ | ✅ | — | ✅ ready |
| A4 | DCC short/long + speed-step subfield | ✅ | ✅ | — | ✅ ready |
| **A5** | Search by **Name** | ❌ | ❌ | Throttle: text input → app-side encoder packs digit runs into nibbles, leaves Address-only=0. CS: per-train SNIP name (see C4) so the match has anything to bind to. | ✅ ready — match logic is in `protocol_train_search_handler.c`; SNIP name comes from whatever the node was created with |
| **A6** | Multi-term AND (0xF separator, §5.2 Table 2) | ❌ | ❌ | Throttle: "Advanced search" with up to 3 terms; app-side encoder concatenates 6-nibble blocks separated by 0xF. | ✅ ready — match logic is already nibble-aware; encoder lives in JS |
| **A7** | Producer Identified Valid / Invalid / Unknown differentiation (§6.4) | partial | ❌ | Throttle: subscribe to `onProducerIdentifiedClear` + `onProducerIdentifiedUnknown`, filter on the train-search event range, render in roster with status pill. | ✅ ready — `openlcb_main_statemachine.c:811,863,873` routes non-Valid PI MTIs to the generic event-transport callbacks (already in WASM ABI) |
| **A8** | Enumerate-all-trains via Is Train event (`01.01.00.00.00.00.03.03`) | ❌ | n/a | Throttle: button → `Identify Producer` for the Is Train event ID; reuse existing Verify-NodeID + roster path. | ✅ ready — every train auto-registers as Is Train producer when `PSI.TRAIN_CONTROL` is set |
| A9 | 200 ms wait before allocate (§6.2) | n/a | ⚠️ | No CS code change needed; verify behavior with a real-train-on-bus smoke test. | ✅ ready — `protocol_train_search_handler.c` `_pending[]` queue with `ticks_remaining` |

## B. TrainControl — Throttle gaps

| # | Feature | Status | Recommendation | CLib readiness |
|---|---|---|---|---|
| B1 | Set Speed / Set Function / Emergency Stop | ✅ | — | ✅ ready |
| B2 | Query Speeds / Query Function | ✅ | — | ✅ ready |
| B3 | Assign / Release Controller | ✅ | — | ✅ ready |
| B4 | Heartbeat reply (Noop or any command) | ✅ | — | ✅ ready |
| **B5** | Query Controller (0x20/0x03) + reply | ❌ | After search-hit click, send Query Controller before Assign; show "Held by `0x…`. Take over?" if non-zero. | ✅ ready — `wasm_train_send_query_controller` + `onTrainControllerQueryReply` already wired |
| **B6** | Controller Changing Notify (0x20/0x04) flow | ❌ | On override-confirmed: `sendControllerChangingNotify(prev)` → wait for `onTrainControllerChangedNotifyReply` (or 1 s timeout) → only then Assign. | ✅ ready — sender + reply hook are in WASM ABI |
| **B7** | Receive Notify-Request when WE are being displaced | ❓ | Subscribe to `onTrainControllerChangedRequest`; return true → release locally; false → refuse. Show non-modal banner "Another controller is taking this train." | ✅ **already wired** — `protocol_train_handler.c:767-778` fires the callback on the receiving node regardless of `train_state`; route maps in `wasm-api.js:95` |
| **B8** | Reserve / Release Reserve (0x40/0x01, 0x40/0x02) + reply | ❌ | "Reserve" toggle in throttle screen header; surround scripted ops with reserve→ops→release. Mark "advanced". | ✅ ready — sender + `onTrainReserveReply` wired; CLib enforces second-reserve-from-different-source rejection (`protocol_train_handler.c:943-950`) |
| **B9** | Listener Attach / Detach / Query (0x30/01-03) + replies | ❌ | "Consist" tab — list of NodeIDs with the 4 flag chips (Rev Dir / Link F0 / Link Fn / Hide), Add/Remove/Refresh actions. | ⚠️ **CLib has the reply callbacks** (`on_listener_attach_reply` / `_detach_reply` / `_query_reply` in `protocol_train_handler.h:132-138`) **but `wasm-api.js` and `bindings.c` do not expose them.** Senders are exposed |
| **B10** | F0–F68 + Binary State Controls + Analog Outputs (§7.1) | partial | UI only — extend `FN_LABELS` to F69, add Binary State and Analog panels. Senders already accept any 24-bit address. | ✅ ready — `wasm_train_send_set_function` already takes `uint32_t` address |
| B11 | Layout Emergency PCERs | ✅ | — | ✅ ready |
| **B12** | Terminate Due To Error (0x1021 = not a controller) | ❌ | Subscribe to `onTerminateDueToError`; on 0x1021 auto-release locally and toast "Lost control of `<train>`". | ✅ ready — `wasm-api.js:76` already routes this |

## C. TrainControl — CS gaps

| # | Feature | Status | Recommendation | CLib readiness |
|---|---|---|---|---|
| C1 | Allocate-on-search, virtual node creation | ✅ | — | ✅ ready |
| C2 | Speed/function/emergency callbacks → mock track driver | ✅ | — | ✅ ready |
| C3 | Heartbeat enforcement (10 s default) | ✅ | — | ✅ ready |
| **C4** | Per-train operator-set SNIP name | ❌ | Honor add-train-form name; expose roster inline-rename. Enables A5. | ⚠️ partly ready — `wasm_node_set_snip` is called at create time; runtime SNIP-update path is not exposed. Either rebuild the node or add a small CLib helper (E7) |
| **C5** | `onTrainControllerAssignRequest` accept/reject | ❌ | Per-train Lock toggle in roster row → callback returns false. Optional global "Confirm each request" mode. | ✅ ready — `wasm-api.js:94` wires `onTrainControllerAssignRequest(currentCtrl, requestingCtrl) → bool` |
| **C6** | `onTrainControllerChangedRequest` accept/reject | ❌ | Same Lock policy as C5. | ✅ ready — same as B7 (single callback covers both directions of dispatch) |
| **C7** | Listener Configuration (server side) | ❌ | Roster row shows listener-count badge → expandable sub-table of NodeID + flags; operator can detach via row action. | ⚠️ server-side store + forward already implemented in `protocol_train_handler.c::_handle_listener_config`, `_forward_to_next_listener`. `onTrainListenerChanged` notification is wired but **listener-list introspection from JS has no read API** — need an enumerator export |
| **C8** | Reserve / Release Reserve handling | ❌ | Surface `reserved` state in roster as a small badge. | ⚠️ CLib enforces server-side but **does not surface state through any callback or `wasm_train_get_*` getter**. Needs a small read-only ABI export (`wasm_train_get_reserved_node_id`) or a "reserved-changed" callback |
| **C9** | Originate Is Train enumeration response | likely auto | Verify with JMRI test that `Identify Producer 01.01.00.00.00.00.03.03` produces N replies. | ✅ ready — auto-handled when PSI.TRAIN_CONTROL is set |
| **C10** | Listener-aware roster surface | ❌ | Falls out of C7. | ⚠️ same as C7 |

## D. Memory Spaces (deferred v2 in PLAN.md)

| # | Feature | Status | Recommendation | CLib readiness |
|---|---|---|---|---|
| D1 | FDI 0xFA — CS publishes, throttle reads function labels | ❌ v2 | CS: build FDI XML at allocate time, serve from `onConfigMemRead(space=0xFA)`. Throttle: on assign, read remote 0xFA, parse, replace hardcoded `FN_LABELS`. | ⚠️ **server side ready** (`ProtocolConfigMemReadHandler_read_space_train_function_definition_info`); **client side: function exists** (`ProtocolConfigMemReadHandler_read_request_train_function_definition_info`) **but no WASM export and no JS-side reply-data callback path designed.** Largest single piece of library work |
| D2 | Function Information 0xF9 via memory config | ❌ v2 | Skip until a real use case appears — Set/Query Function already covers F0–F68 in the wire path. | ⚠️ same shape as D1 — server fns implemented, client read not exposed |
| D3 | CDI 0xFF — for SNIP-richer throttle UI | ❌ v2 | CS: publish minimal CDI describing per-train address/long/steps/name. Throttle: out of scope. | ⚠️ same shape — `ProtocolConfigMemReadHandler_read_request_config_definition_info` exists but not WASM-exposed |

---

## E. CLib / WASM-binding investigations

| # | Question | Outcome |
|---|---|---|
| E1 | Are Listener Attach/Detach/Query Replies surfaced to JS? | **Library binding work needed** — CLib has all three callbacks; missing in `bindings.c` and `wasm-api.js` |
| E2 | Can a throttle observe "you are being displaced" Notify-Request? | **Already works** — subscribe to existing `onTrainControllerChangedRequest`; the C handler (`protocol_train_handler.c:767`) does not gate on `train_state` |
| E3 | Are PI Invalid/Unknown delivered for train-search events? | **Already works** — main statemachine routes non-Valid PI MTIs to the generic event-transport callbacks, which are wired |
| E4 | Client-side `readRemoteMemory` | **Partial** — CLib has `ProtocolConfigMemReadHandler_read_request_*` for every space; **WASM ABI export missing**, and the **reply-payload-to-JS delivery path is not designed** (datagram payload routing) |
| E5 | Multi-term `tsCreateEventId` | **App-side only** — keep encoder in JS; no ABI churn |
| E6 | 200 ms allocate debounce | **Already works** — `_pending[]` ticks queue in CLib |
| E7 | Runtime SNIP update on a created node | **Open** — `wasm_node_set_snip` is called from the node-builder before `createNode`. Either accept "rename = recreate node" or add a small CLib `wasm_node_update_snip_*` helper |
| E8 | Reserved-state introspection from JS | **Open** — `state->reserved_by_node_id` is stored but not exposed; needs a getter or a "reserved changed" callback |

---

# Plan to make every "CLib readiness" column green

The tables above have three categories of non-green entries. The plan below
takes them in increasing order of effort.

## Tranche 1 — WASM bindings only (no C protocol changes)

These add `wasm_*` exports and `Module.on*` hooks for things the CLib
already implements. Pure plumbing.

### Tranche 1a — Listener replies (resolves B9, partly C7 — covers gap E1)

CLib side (already present, no change):
- `interface_protocol_train_handler_t::on_listener_attach_reply`
- `interface_protocol_train_handler_t::on_listener_detach_reply`
- `interface_protocol_train_handler_t::on_listener_query_reply`
- Wiring in `openlcb_config.c` (already wires
  `on_train_listener_attach_reply` / `_detach_reply` / `_query_reply`).

Bindings work (`OpenLcbCLib/wasm/bindings.c`):
- Add three exports that call back into JS via `EM_ASM`/`emscripten_run_script`
  using the same pattern as the existing listener-changed hook.

WASM-api work (`OpenLcbJSLib/src/openlcb/internals/wasm-api.js`):
- Add three lines in `createHooks`:
  ```
  onTrainListenerAttachReply: (nid, nodeId, result) =>
      dispatch(nid, 'onTrainListenerAttachReply', BigInt(nodeId), result),
  onTrainListenerDetachReply: (nid, nodeId, result) =>
      dispatch(nid, 'onTrainListenerDetachReply', BigInt(nodeId), result),
  onTrainListenerQueryReply:  (nid, count, index, flags, nodeId) =>
      dispatch(nid, 'onTrainListenerQueryReply', count, index, flags, BigInt(nodeId)),
  ```
- No `createApi` cwrap entries — these are inbound only.

### Tranche 1b — Reserved state introspection (resolves C8 — covers gap E8)

Decision: getter vs callback. Recommend getter (mirrors
`wasm_train_get_dcc_address` etc.).

CLib side (`openlcb_application_train.c` + `.h`):
- Add `node_id_t OpenLcbApplicationTrain_get_reserved_by_node_id(openlcb_node_t *node)`
  that returns `state->reserved_by_node_id` or 0 if no `train_state`.
- Wrap in the appropriate `OPENLCB_COMPILE_TRAIN` ifdef per CLAUDE.md.

Bindings work (`OpenLcbCLib/wasm/bindings.c`):
- Export `wasm_train_get_reserved_by_node_id(bigint nodeId) → bigint`.

WASM-api work (`OpenLcbJSLib/src/openlcb/internals/wasm-api.js`):
- One cwrap entry: `tGetReserved: c('wasm_train_get_reserved_by_node_id', 'bigint', ['bigint']),`.
- Expose via `node.train.getReservedByNodeId()` in `node.js`.

CS app — surface in the roster row's `reserved` badge.

### Tranche 1c — Listener list introspection (resolves remaining C7 / C10)

Decision: there are two ways:
- (a) Expose a synchronous getter array (read out
  `train_state->listener_list`) — fast, one round-trip.
- (b) Re-use the existing wire-level Listener Query — works without any
  new C, but is asynchronous and chatty.

Recommend (a) for the CS roster surface; (b) for cross-node throttle UX.

CLib side (`openlcb_application_train.c` + `.h`):
- Add `uint8_t OpenLcbApplicationTrain_get_listener_count(openlcb_node_t *node)`.
- Add
  `bool OpenLcbApplicationTrain_get_listener_at(openlcb_node_t *node, uint8_t index, node_id_t *out_node_id, uint8_t *out_flags)`.

Bindings + WASM-api: two new cwrap entries each. Trivial.

CS app — expand row to render listener entries from this getter.

## Tranche 2 — Small CLib helpers (no protocol changes)

### Tranche 2a — Runtime SNIP update (resolves C4 — covers gap E7)

Required so search-by-name and inline rename work without restarting nodes.

CLib side (`openlcb_application.c` or wherever SNIP fields live):
- Add `bool OpenLcbApplication_set_snip_name(openlcb_node_t *node, const char *name)`
  and similar for `model`, `hardwareVersion`, `softwareVersion`,
  `userVersion`. Updates the in-memory SNIP buffer; clients that
  subsequently read SNIP get the new value.
- Wrap in `OPENLCB_COMPILE_SIMPLE_NODE_INFO_PROTOCOL` (verify exact flag).

Bindings work:
- Export `wasm_node_update_snip_name(bigint nodeId, string name) → number` (and
  the other fields if needed).

WASM-api / node.js:
- Surface as `node.updateSnip({ name, model, … })` that calls the per-field
  exports.

CS app — add the inline-rename action; allocate-on-search uses the
post-create rename to honor the form's name field.

## Tranche 3 — Largest piece: client-side remote memory read

Resolves D1, D2, D3 (covers gap E4). Required for FDI/CDI throttle UX.

This needs design before code, because the read response data has to
make its way back to JS. Sketch:

### CLib side

- Existing `ProtocolConfigMemReadHandler_read_request_*` functions are
  callable but currently designed for in-process consumers; the handler
  state machine completes the datagram exchange and lands the data in a
  `configuration_memory_buffer_t`.
- Add a new completion callback to
  `interface_protocol_config_mem_read_handler_t`:
  ```
  void (*on_remote_read_complete)(
      openlcb_node_t *requester,
      node_id_t target_node,
      uint8_t space,
      uint32_t address,
      const uint8_t *data,
      uint16_t length,
      uint16_t status);    // 0 = OK, non-zero = error code
  ```
- Wire it up so each `read_request_*` records a "request token" that
  gets matched to the incoming reply datagram and then fires the
  callback.

### Bindings side

- Export `wasm_config_mem_send_read_request(bigint requesterId,
  bigint targetNodeId, uint8_t space, uint32_t address, uint16_t length)
  → number` (returns a request handle / status).
- Export the matching hook so JS receives `(requesterNid, targetNid, space,
  address, dataPtr, length, status)`. Use the existing heap-pointer pattern
  from `onConfigMemRead`.

### JS side

- Add `OpenLcbConfig.readRemoteMemory(requesterNode, targetNodeId, space,
  address, length) → Promise<Uint8Array>` that wraps the request and
  resolves on the matching completion callback.
- Add minimal FDI XML parser (CS-side optional generator can come later).

### App work

- CS: build FDI XML for each allocated train (default labels +
  optional roster overlay), serve via existing `onConfigMemRead(space=0xFA)`.
- Throttle: on `onTrainControllerAssignReply(0)`, fetch FDI from the
  assigned train, parse, replace the hardcoded `FN_LABELS` array.

## Tranche 4 — Verification only (no code)

A9 (200 ms wait), C9 (Is Train enumeration). One-time JMRI smoke test
each — confirm behavior, then mark green.

---

## Suggested execution order

1. **Tranche 1a + 1b** in one PR — small, reviewable, unlocks B9 / C8.
2. **Tranche 1c** alongside the CS listener-roster UI changes.
3. **Tranche 2a** as a standalone PR — used by both the CS rename UI
   and any future search-by-name throttle feature.
4. **Tranche 4** verification — fold into the test suite as
   regression cases.
5. **Tranche 3** (D1/D2/D3) last — it's a real design conversation
   about how datagram-stream replies surface to JS, and it gates FDI
   work that's already explicitly v2 in the example PLAN.md files.

Each tranche leaves the codebase shippable; nothing in Tranche 3 is on
the critical path for the high-value Phase-1/Phase-2 example app work.

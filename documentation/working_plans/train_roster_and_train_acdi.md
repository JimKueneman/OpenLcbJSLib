# Train Roster, NodeID Pool, and "Train ACDI" — Working Plan

**Status:** design notes, not yet a commitment.
**Scope:** how the Command Station example should manage virtual train identity,
persistence, and discovery — and what would need to land at the spec level to
make this clean across vendors.

This note captures a design conversation triggered by the Memory Configuration
persistence work in `examples/train_command_station/`. None of the code in this
note has been written.

Spec references:
- `OpenLcb Documents/standards/MemoryConfigurationS.pdf` — ACDI flag bits in
  Get Configuration Options Reply (§4.14)
- `OpenLcb Documents/standards/TrainSearchS.pdf` — request/reply contract,
  matching algorithm (§6.3)
- `OpenLcb Documents/standards/TrainSearchTN.pdf` — recommended throttle UI
  flows (§5)
- `OpenLcb Documents/standards/TrainControlTN.pdf` — **§4.3.1 "Roster
  Information" (three approaches, MTIs `0xDA8`/`0x9C8` reserved), §4.3.2
  "Train Identification" (User Name convention), §4.3.3 (DCC CV space
  `0xF8` already taken)**
- `documentation/train_protocol_gap_analysis.md` — what the example apps
  already implement

---

## 1. The problem

Today's CS derives each virtual train's NodeID from its DCC address:
`trainNodeId(addr) = CS_BASE | BigInt(addr)`. The Memory Configuration
persistence work we just landed keys storage by NodeID. That works while
"DCC address" is a stable identity, but breaks the moment:

- A physical loco is re-decoded onto a different DCC address (NodeID changes,
  data is lost).
- A DCC address is reassigned to a different physical loco (NodeID is the
  same, data now belongs to the wrong train).

For a club layout where users add/remove trains over time and a CS database
might hold thousands of road numbers, the NodeID = identity assumption is
fundamentally wrong. Train metadata (road name, road number, type, sound
profile, function labels) needs to follow the **physical train**, not the
DCC slot it currently occupies.

---

## 2. Why we can't pre-allocate stable NodeIDs per train

The first instinct ("give every roster entry its own permanent NodeID")
doesn't ship. A manufacturer's NodeID block is finite. A CS that supports
1000 trains can't burn 1000 NodeIDs from the manufacturer's pool **for every
device shipped**. With a typical 24-bit allocation block (~16M IDs), that's
only 16K shipped CSes before the block exhausts.

Real CSes get **one** NodeID at manufacture time. The pool of train NodeIDs
the device can hand out at runtime has to be small (say 64 or 128) and
**reused** across sessions.

---

## 3. Proposed direction: roster + NodeID pool (Option B)

The roster identity is the stable, persistent thing. The NodeID is a
transient resource the CS hands out from a small pool while a train is
"active" (a throttle is interested in it).

```
Roster file (persistent)               NodeID pool (transient, small)
-----------------------------          --------------------------------
rosterId    "bnsf-3849"                pool size = 64-128
dccAddress  7                          allocated to "bnsf-3849" → 0x...0807
long        false                      free                     → -
steps       128                        free                     → -
roadName    "BNSF"                     ...
roadNumber  "3849"
type        "SD40-2"
name        "BNSF SD40-2 #3849"
```

### Lifecycle

1. CS startup: load roster (no NodeIDs assigned yet).
2. Throttle search arrives → CS resolves DCC address (or text query) against
   roster → finds entry `bnsf-3849` → grabs an unused NodeID from the pool →
   tells storage "NodeID `0x...0807` maps to `bnsf-3849`" → creates the
   OpenLCB train node with that NodeID + roster-derived SNIP/CDI.
3. Throttle disconnects (or idle timeout) → CS releases the NodeID back to
   the pool → roster entry stays put on disk → on next session a *different*
   NodeID may map to the same `bnsf-3849`.

### Storage layer change

`LocalStorageConfigMemory` learns about a resolver that maps NodeID →
rosterId. Internally it stores under rosterId, not NodeID. NodeID can change
session-to-session; bytes stay attached to the train.

```js
new LocalStorageConfigMemory({
    size: 256,
    keyForNode: (nodeId) => csRoster.rosterIdForNode(nodeId),
});
```

### Throttle is unaffected

The throttle searches by DCC address (or text) and gets back whatever NodeID
the CS allocated this session. The throttle never caches NodeID across
reconnect — it always re-searches. No spec or throttle change required.

### Speed steps follow the roster

Roster owns each train's `steps`. Throttle search defaults to
`STEPS_DEFAULT=0` ("any"). CS responds with the roster entry's actual steps;
throttle reads them from the train info and adapts its UI. The throttle's
current `stepMode` chip (14/28/128) is the wrong place for that information
to live — it's exposing a decoder detail to the wrong audience and forces
the user to know something they shouldn't have to know.

---

## 4. Why SNIP follow-up doesn't actually solve the display-name problem

A throttle that searches by DCC address gets back NodeIDs but not human
names. The first instinct is "follow up with SNIP per result, build a pick
list." But SNIP only returns what the CS *put into the train node's SNIP
fields when it allocated the node*. If the CS doesn't have a roster, the
only thing it can put there is a synthesized `DCC <addr>` string. SNIP
faithfully delivers garbage.

The roster fixes this end-to-end:
- CS allocates each train with `snip.user_name = roster_entry.name` (or
  similar denormalization)
- SNIP follow-up returns the operator-set name, not `DCC N`
- Both ends of the SNIP conversation become useful

But the same constraint also flags a structural problem (next section).

---

## 5. The structural ceiling: SNIP user_name is a 63-byte blob

Even with a real human name in `snip.user_name`, **structured fields**
(road name / road number / type / era / owner) can't all live in 63
characters of free-form text. A vendor-specific concatenation
(`"BNSF 3849 SD40-2"`) buys nothing for interop — to a different
vendor's throttle it's still an opaque blob. The whole point of having
structured fields is so different throttles can display, sort, and filter
independently.

**The spec already establishes the convention** that the SNIP user_name is
the operator-set free-form display string. From TrainControlTN §4.3.2:

> "OpenLCB throttles are expected to use the 'User Name' field (from SNIP
> and ACDI) as locomotive name on the display. The Train Search Protocol
> specifies that the User Name field shall be searched for cab numbers
> when a throttle is searching for or attempting to select a locomotive."

So free-form user_name is "decided" — what's missing is a place to put
**structured roster fields** (road name, road number, type, …) that
throttles can read independently and that survives across vendors.

That problem is **explicitly listed as future work in TrainControlTN
§4.3.1 "Roster Information"** with three documented approaches and
already-reserved MTIs. See §6.

---

## 6. Train SNIP / Train ACDI / "Simple Train Node Ident Info" — what's already in the spec

`TrainControlTN §4.3.1` lists three approaches as future work. None has
been implemented yet but one of them already has reserved MTIs:

### Approach (a) — Extend ACDI/SNIP with a third block

A new ACDI-style block, only present when the node implements the Train
Control Protocol (advertised via PIP). Block is versioned/typed so the
field set can grow over time. This is the smallest spec increment — it
slots into the existing Get-Configuration-Options-Reply ACDI flag-bit
pattern.

### Approach (b) — Create a new version of the user block

Extend the existing `0xFB` user space with a v2 layout that adds
train-specific fields. Backward compatible by version byte.

### Approach (c) — New memory space + new MTI ("Simple Train Node Ident Info Protocol")

Fixed-layout memory space modeled on ACDI, plus a new broadcast/reply
message pair. **MTIs `0xDA8`/`0x9C8` are tentatively reserved for this**,
per the TN. This is closest to the original "Train SNIP" proposal — same
architectural shape, broadcast enumeration without per-train datagram
round-trips.

> **Historical note:** the original author of this approach had a
> *working demo* that got far enough along for the MTIs to be formally
> reserved. The TN text labels it as "future work" with no production
> implementation, but the proposal was demonstrably more complete than
> the spec wording suggests. The demo code and design notes are not
> recoverable (too long ago), so anyone driving this forward will be
> re-deriving the field set, framing, and edge-case handling from
> scratch — but the MTI reservation and the field-set hints in §4.3.1
> remain useful starting points.

### Suggested initial field set (§4.3.1)

The TN suggests (referencing JMRI roster3 / Rocrail):
- **Road Name**
- **Road Number**
- (Manufacturer / model / owner description / comments — already in ACDI/SNIP)
- For DCC additionally: **DCC Address**, **Decoder Type (Manufacturer, model)**

### Imagery (§4.3.2 future work, references RCN-218 / NMRA S-9.1.2.2)

Already-defined elsewhere:
- 2-bit locomotive category (Steam / Diesel / Electric / Railcar)
- 16-bit enumeration index into a stock-image database
- URL string for additional imagery
- Plus per-vendor uploaded imagery keyed by hardware unique ID

### Memory space allocation gotcha

`0xF8` is **already in production use for DCC CV programming** per
TrainControlTN §4.3.3. So Approach (a) or (b) using a new memory space
must avoid `0xF8`. The TN doesn't propose a specific number for the
roster space — open question for the spec proposal.

### Tradeoffs

- **(a)** Smallest spec proposal. Reuses existing Memory Config protocol
  (no new MTI). Datagram round-trips per train means N reads for N
  trains in a pick list. Backward compatible via existing
  Get-Configuration-Options flag bits.
- **(b)** Even smaller spec — just a v2 byte for the existing `0xFB`
  layout. But ACDI user space is conventionally for *operator-set*
  identification; cramming structured roster fields there muddles its
  semantics.
- **(c)** Architecturally cleanest for enumeration (broadcast, single
  round-trip), but requires a new MTI implementation in every CS,
  throttle, and CDI tool. Reserved MTIs already exist (`0xDA8`/`0x9C8`).

For the throttle's hot path (search → pick list → drive), (a) or (b) are
the cheaper near-term moves; (c) is the architecturally correct answer if
we want efficient bulk enumeration.

---

## 7. What we can do without spec changes

Everything in §3 (roster + NodeID pool + storage indirection) is **CS-app-
side work**. No CLib, WASM, or spec changes needed. Concrete pieces:

- **`src/storage/local-store.js`** — already gives us NodeID-namespaced KV.
  Add an alternate `LocalStorageConfigMemory` constructor accepting a
  `keyForNode` resolver so storage keys by rosterId instead of NodeID.
- **`examples/train_command_station/cs_roster.js`** (NEW) — roster module:
  load/save JSON via `LocalStore`, lookup by DCC address / by text,
  NodeID pool allocator, NodeID → rosterId mapping table.
- **`examples/train_command_station/command-station.js`** — wire it:
    - Replace `trainNodeId(addr) = CS_BASE | addr` with roster lookup +
      pool allocator.
    - In `onTrainSearchNoMatch` (allocate-on-search), append a new roster
      entry with synthesized name `DCC <addr>` (matches commercial CS
      convention) and proceed.
    - On train release / idle timeout, free the NodeID back to the pool.
- **CDI Train Identification (interim convention)** — adopt our own
  `cdi_train.xml` layout as a de-facto "Mustangpeak Train Identification
  Segment v1" so all our CS implementations use the same byte offsets.
  Not interoperable with other vendors but at least reproducible across
  ours; promoted to Train ACDI when/if that lands.

### What's deferred until Train ACDI lands

- Cross-vendor reading of train identification fields (until then, only our
  own CS / throttle / JMRI-with-our-CDI know the layout).
- Throttle implementing rich pick lists with road number + type as separate
  fields (only our SNIP user_name denormalization works without per-vendor
  knowledge of CDI offsets).

---

## 8. Synthesized "DCC N" fallback for unconfigured trains

Independent of the roster work, the CS's `config_memory_read` callback for
a train node should synthesize `DCC <addr>` when the user-name bytes
(0..62 of `0xFD`) read back as all zero. This matches commercial CS
convention (NCE / Digitrax / ESU all do flavors of this) so a throttle
showing an unconfigured train doesn't see a blank name. ~10 lines.

The moment the operator types a real name in JMRI's CDI editor, the bytes
are no longer zero and the synthesized fallback stops firing.

---

## 9. Throttle-side spec gaps that would unlock the roster's value

From `documentation/train_protocol_gap_analysis.md`, the throttle today is
numeric-search only. With a roster behind the CS, the throttle can do
much more, but needs:

- **Text-based search** — input that builds queries with `F`-separated
  digit groups for the spec's Name-matching branch (§6.3 of TrainSearchS).
- **SNIP follow-up** — after each search hit, fetch the train's SNIP
  user_name and show it in the pick list (instead of `DCC <addr>`).
- **Smart-throttle defaults** — incremental search with `rr=0x00` while
  user types, `rr=0xE0` on Enter (per TrainSearchTN §5).
- **Result quality differentiation** — surface Valid > Invalid > Unknown
  in the pick list ranking.

Defer these until the roster work is done — they have no point until the
CS has rich names to return.

---

## 10. Open questions

- **NodeID pool size**: 64? 128? Per-CS configurable? Picked once at compile
  time per device?
- **Pool exhaustion behavior**: silently drop new search-with-allocate? Drop
  oldest idle assignment? Surface to operator?
- **Roster source of truth**: localStorage JSON only? Disk file via File
  System Access API? Imported from JMRI roster XML? UI to edit in the CS
  page? All viable, can land incrementally.
- **Train ACDI spec proposal**: who drives it? Worth doing the writeup
  before we have a working CS implementation, or after?
- **Roster persistence schema versioning**: when we add fields, how do we
  migrate existing entries without losing data?

---

## 11. References

- `examples/train_command_station/openlcb_user_config_command_station.js`
- `examples/train_command_station/openlcb_user_config_train.js`
- `examples/train_command_station/cdi_train.xml`
- `examples/train_command_station/fdi_train.xml`
- `examples/train_command_station/command-station.js` (`allocateTrain()`,
  `onTrainSearchNoMatch`, `trainCallbacks()`)
- `src/storage/local-store.js`
- `src/storage/localstorage-config-memory.js`
- `OpenLcbCLib/src/openlcb/protocol_snip.c` — SNIP fields read from config
  memory at fixed offsets
- `OpenLcbCLib/src/openlcb/openlcb_defines.h` — `CONFIG_MEM_CONFIG_USER_*`
  offsets

---

## Decision log

- **Option A (stable NodeID per roster entry) rejected** — burns
  manufacturer NodeID block at unsustainable rate.
- **Option B (NodeID pool, roster identity persisted)** — chosen as the
  CS-side path. No spec change required.
- **SNIP user_name as operator-set free-form display name** — chosen.
  Matches the established convention in TrainControlTN §4.3.2. Single
  63-char UTF-8 string, primary throttle pick-list field.
- **Train identification structured fields are documented future work** —
  TrainControlTN §4.3.1 lists three candidate approaches (extend ACDI
  with a third block; new version of user block; new memory space + new
  MTI). MTIs `0xDA8`/`0x9C8` already tentatively reserved for the third
  approach. None implemented in production. Our independent "Train
  ACDI" idea matches approach (a). Defer driving any of the three to
  formal spec until our CS work proves the use case.
- **Memory space `0xF8` is taken** for DCC CV programming
  (TrainControlTN §4.3.3) — must pick a different number for any
  Train-ACDI-style space.
- **Free-form user_name + (later) structured spec'd block — they're not
  in conflict.** User_name is the throttle-display-string convention;
  the structured block is for richer roster data. Both can coexist and
  serve different consumers.

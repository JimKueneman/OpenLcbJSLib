# OpenLcbJSLib tests

This folder contains the library's test surface. There are two independent layers:

1. **In-process integration tests** — `integration.mjs`. Fast, no network, no external tools.
2. **External conformance harness** — `harness/`. Exposes the library as a virtual node on TCP GridConnect and drives it with [OlcbCheckerClone](https://github.com/bobjacobsen/OlcbCheckerClone).

---

## Layout

```
test/
├── integration.mjs                  # in-process end-to-end tests
├── harness/
│   ├── run-node.mjs                 # TCP GridConnect server, 1 virtual node
│   ├── tcp-gridconnect-server.mjs   # single-client TCP server used by run-node
│   ├── run-conformance.mjs          # orchestrator: harness × checker matrix
│   ├── conformance-map.mjs          # mode → list of checker scripts
│   └── conformance-results.json     # latest run-conformance output
└── README.md
```

---

## 1. Integration tests — `integration.mjs`

End-to-end tests that drive the full `OpenLcbConfig` stack through a `MockWebSocket` and assert on the GridConnect frames the library emits. No TCP server, no external process, no real WebSocket — everything runs in one Node process.

### What it covers

| Test | What it verifies |
|---|---|
| Full CAN + OpenLCB login sequence emits expected frames | CID1–CID4, RID, AMD, Initialization Complete ordering and content |
| Verify Node ID Global elicits Verified Node ID reply | MTI `0x0490` → `0x0170` with correct source/data |
| Protocol Support Inquiry (addressed) returns PIP reply | PIP bitmask matches the flags wired in `openlcb_config.c` |
| Consumer Identify for a known event returns Consumer Identified | Event ID lookup + `EVENT_STATUS`-tagged reply |
| Consumer Identify for an UNKNOWN event yields no reply | Silence on non-matching event IDs |
| SNIP request returns a well-formed SNIP reply | Addressed reply, correct version byte, null-terminated strings |
| Datagram with unknown command byte returns Datagram Rejected | Datagram receive path + rejection encoding |
| `config.stop()` cleanly closes transport and run loops | No lingering timers / handles after shutdown |

### How it works

`MockWebSocket` stands in for a real browser `WebSocket` — `send()` pushes into an array, and a test-only `inject(gcString)` helper feeds GridConnect frames in from the "wire" side. Each test builds an `OpenLcbConfig`, injects frames, waits for the 100 ms internal tick to advance the login state machine, and asserts on `mockWs.sent`.

### How to run

```sh
node test/integration.mjs
```

Exits non-zero on the first failing assertion and prints the stack. Takes a few seconds — most of it is `wait()` calls letting the login state machine progress.

---

## 2. Conformance harness — `harness/`

The harness exposes one virtual OpenLCB node on a TCP GridConnect server (default `localhost:12021`). External tools — primarily OlcbCheckerClone — connect to it and exercise the library exactly as they would a real hardware node.

### `run-node.mjs` — single virtual node

Starts the node in one of four **mutually-exclusive modes**, mirroring `OpenLcbCLib/test/compliance_node/ComplianceTestNode/protocol_modes.c`. Each mode advertises a different PIP bitmask and sets up matching application-layer state.

```sh
node test/harness/run-node.mjs --mode <name> [--port 12021] [--node-id 05.01.01.01.07.07] [--fresh] [--trace]
```

| `--mode` | PIP bits advertised | Application setup | Checker sections exercised |
|---|---|---|---|
| `basic` (default) | Datagram, MemCfg, EventExchange, SNIP, CDI, Stream | Emergency-stop consumer + duplicate-node / ident-button producer | 0 Frame, 1 Message, 2 SNIP, 3 Events, 4 Datagram, 5 MemCfg, 6 CDI, 11 Stream |
| `train` | basic + TrainControl + FunctionDescription | `applicationTrain.setup()` on main node + 3 pre-allocated virtual trains (id+1..id+3); DCC addr 3, 128 speed steps, 3 s heartbeat; FDI address space 0xFA enabled with a minimal `<fdi>` XML | 7 Train Control, 8 Train Search, 9 FDI |
| `broadcast-time-producer` | basic | `applicationBroadcastTime.setupProducer(BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK)` — node becomes the default-fast-clock generator | 10 Broadcast Time (Producer path) |
| `broadcast-time-consumer` | basic | `applicationBroadcastTime.setupConsumer(BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK)` — node becomes a default-fast-clock display | 10 Broadcast Time (Consumer path) |

**DCC Detector (section 12) and Firmware Upgrade are intentionally not harnessed.** Both assume the node is a hardware device — a browser virtual node has no track feedback and no flash to reprogram. See `documentation/plan.md` for the DCC rationale; Firmware Upgrade follows the same logic.

- `--fresh` wipes persistent config memory under `./.openlcb-cfg/` so each run starts clean.
- `--trace` prints every GridConnect frame in both directions.

### `tcp-gridconnect-server.mjs`

Minimal single-client TCP server used by `run-node.mjs`. Accepts one client at a time and **rejects** any second connector (common on localhost — stray port scanners, leftover JMRI sessions, old browser tabs) so a probing connection can't preempt an in-progress checker session. You'll see `[tcp] rejecting additional connection...` in the harness log when this happens; it's cosmetic.

### `run-conformance.mjs` — full matrix orchestrator

Single entry point that runs every mapped checker script in every mode and prints a pass/fail/skip matrix. Does **not** use `control_master.py` and does **not** modify OlcbCheckerClone.

For each mode in `conformance-map.mjs`:
1. Spawn `run-node.mjs --mode=<mode> --fresh`
2. Wait for stdout line matching "TCP server listening"
3. For each mapped script: spawn `python3 <script> -a host:port -t <id> -i --auto-reboot`, capture stdout, classify by keywords + exit code, push a row to the results table
4. SIGINT the harness, wait for exit, next mode

One failing check does **not** abort the matrix — it keeps running.

```sh
node test/harness/run-conformance.mjs [--modes basic,train,...] \
                                      [--port 12021] \
                                      [--node-id 05.01.01.01.07.07] \
                                      [--per-check-timeout 60] \
                                      [--json test/harness/conformance-results.json] \
                                      [--python python3] \
                                      [--verbose]
```

Output lands in `conformance-results.json`. Overrides: `check_bt50_freq.py` gets 180 s (it monitors Report Time events for 130 s).

### `conformance-map.mjs`

Pure data. Maps each harness mode to the list of OlcbCheckerClone script filenames it should run. Edit this when adding new checker coverage; no code changes elsewhere are required.

---

## 3. Driving OlcbCheckerClone manually

Use this when you want to run a single section interactively instead of the full matrix.

### Prerequisites

- Node 20+ (for `node test/harness/run-node.mjs`)
- OlcbCheckerClone checked out at `/Users/jimkueneman/Documents/OlcbCheckerClone` with its `venv` populated (`venv/bin/python3.13`)
- Nothing else on TCP port 12021

### Terminal 1 — start the harness

```sh
cd /Users/jimkueneman/Documents/OpenLcbJSLib
node test/harness/run-node.mjs --mode basic --fresh
# or --mode train
# or --mode broadcast-time-producer
# or --mode broadcast-time-consumer
```

### Terminal 2 — drive the checker

```sh
cd /Users/jimkueneman/Documents/OlcbCheckerClone
venv/bin/python3.13 control_master.py \
    -a localhost:12021 \
    -t 05.01.01.01.07.07 \
    -i --auto-reboot
```

That drops you in the interactive menu. Enter the section number you want to run. For train mode, that's `7`, `8`, or `9`; for broadcast-time, `10` (then `p` for producer mode or `c` for consumer mode). Each submenu accepts `a` to run all checks in the section, then `q` to go back.

### Useful flags

| Flag | Meaning |
|---|---|
| `-a host:port` | Connect over TCP GridConnect (instead of serial `-d /dev/cu...`) |
| `-t NN.NN.NN.NN.NN.NN` | Target node ID — match `--node-id` from the harness |
| `-i` | Skip interactive checks (prompts to press a button, reset the node, etc.) |
| `--auto-reboot` | Send the restart datagram instead of prompting for a reset |
| `-w` | Enable write tests against config memory 0xFD (otherwise skipped — protects real hardware) |
| `-r` | Run *all* sections in sequence and exit (no menu) |
| `-T 20` | Verbose trace (message level). `-T 30` adds frame traces, `-T 40` physical layer |

### Non-interactive driving

Pipe menu selections on stdin:

```sh
# Train mode: run all Train Control checks, then quit
printf "7\na\nq\nq\n" | venv/bin/python3.13 control_master.py \
    -a localhost:12021 -t 05.01.01.01.07.07 -i --auto-reboot

# Broadcast time producer: run all Broadcast Time Producer checks
printf "10\np\na\nq\nq\nq\n" | venv/bin/python3.13 control_master.py \
    -a localhost:12021 -t 05.01.01.01.07.07 -i --auto-reboot

# Broadcast time consumer
printf "10\nc\na\nq\nq\nq\n" | venv/bin/python3.13 control_master.py \
    -a localhost:12021 -t 05.01.01.01.07.07 -i --auto-reboot
```

Tips:

- `-r` (run-all) works end-to-end. The harness's TCP server accepts one client at a time and rejects any second connector, so a probing connection can't preempt an in-progress checker session.
- Some sections end by exercising the LCC "connection break" path. Restart the harness between modes (which you already need to do anyway) to keep per-mode results clean.
- If you see `Failure - no reply to PIP request` on the first check of a section, it usually means the checker's probe arrived before the node finished login. Give it an extra second or re-run.

---

## Current conformance status

Snapshot from a full `-r` sweep across all four modes. The JS protocol handlers are still being stabilized so these numbers move; re-run and update rather than trusting the table after a substantive change.

| Section | Mode | Pass | Fail | Notes |
|---|---|---|---|---|
| 0 Frame | basic | Init, AME, Collision, Reserved bit, Capacity, Standard | — | |
| 0 Frame | train | Init, AME, Collision, Reserved bit, Standard | **Capacity** ("no Verified NID reply for check 1" after 600-PCER flood) | Only fails under train mode — RX pipeline backpressure when an addressed message is buried in a PCER burst. |
| 1 Message | basic | Node Initialized, Verify Node, PIP, Optional Interaction Rejected, Duplicate, Simple PIP | — | |
| 1 Message | train | Verify Node, PIP, Optional Interaction Rejected, Duplicate, Simple PIP | **Node Initialized** ("source address not correct") | Train mode has main + 3 virtual trains; all emit `Initialization_Complete` on reboot and the checker fails on the first non-target source. Ordering / filtering issue. |
| 2 SNIP | basic | all | — | |
| 3 Events | basic | all | — | |
| 4 Datagram | basic | all | — | |
| 5 MemCfg | basic | all (writes skipped without `-w`) | — | Stream-based sub-checks skipped — stream bit off in Config Options. |
| 6 CDI | basic | all | — | Stream-based sub-checks skipped. |
| 7 Train Control | train | all 11 (Events, Speed, Function, E-stop, Global E-stop, Global E-off, Memory space, Listener config, Controller Assign/Release/Query, Reserve/Release, Heartbeat) | — | |
| 8 Train Search | train | all 4 (Create Train, Partial Values, Reserved sections 2 & 4) | — | Requires train mode — basic mode has no virtual-train pool so all four fail there by design. |
| 9 FDI | train | all 3 (FDI valid, FDI read, FDI read-only flag) | — | |
| 10 Broadcast Time (producer) | broadcast-time-producer | Clock Producer, Set Immediate Report, Multiple Set Commands, Clock Set, Requested Time | **Report Frequency** (no periodic reports in 130 s), **Date Rollover** (0xF003 not emitted), **Startup Sequence** (post-login sync burst incomplete — missing Start/Stop, Rate, Year, Date, Time PID, Time PCER) | Producer's periodic emit path and post-login startup burst are not firing. |
| 10 Broadcast Time (consumer) | broadcast-time-consumer | Consumer Rate Change | **Consumer Synchronization** (no Consumer Identified for 0xF001 Stop / 0xF002 Start) | Consumer doesn't reply to addressed Identify Consumer for the well-known Start/Stop events. |
| 11 Stream | — | — | — | Not exercised — library advertises Stream in PIP but Config Options stream bit is off, so all stream sub-checks are skipped by the checker. |

Each failure above is a real library-side issue surfaced by the harness, not a harness bug (with two qualifiers noted in the rows above — train-mode multi-node ordering and the basic-vs-train mode gate for Train Search). Log files land in `/tmp/checker-<mode>.log` (checker output) and `/tmp/harness-<mode>.log` (node output) when driven by the shell one-liners in this doc.

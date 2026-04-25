// Wrapper smoke test — exercises the new OpenLcb / OpenLcbNode API against
// a mock transport.  Mirrors the shape of test/wasm_smoke.mjs but at the
// public-API level:
//
//   1. OpenLcb.create() loads WASM and wires the transport.
//   2. createNode() allocates a node with SNIP + PSI.EVENT_EXCHANGE +
//      PSI.SIMPLE_NODE_INFORMATION.
//   3. start() opens the transport and kicks the pump.
//   4. node.loginComplete resolves once the login sequence finishes.
//   5. node.sendPcer() emits one PCER frame over the mock transport.
//   6. stop() closes the transport cleanly.
//
// Run:  node test/wrapper_smoke.mjs

import assert from 'node:assert/strict';
import { OpenLcb, PSI } from '../src/index.js';

// ---------------------------------------------------------------------------
// Mock transport — satisfies the Transport interface the runtime expects:
//   async connect(), async disconnect(), send(payload)
//   onMessage, onError, onStateChange (set by the runtime)
// ---------------------------------------------------------------------------

class MockTransport {
    constructor() {
        this.sent = [];
        this.connected = false;
        this.onMessage = null;
        this.onError = null;
        this.onStateChange = null;
    }
    async connect() {
        // Emulate a real transport that opens asynchronously.
        await Promise.resolve();
        this.connected = true;
        this.onStateChange?.('connected');
    }
    async disconnect() {
        await Promise.resolve();
        this.connected = false;
        this.onStateChange?.('disconnected');
    }
    send(payload) {
        if (!this.connected) throw new Error('mock: send() while disconnected');
        this.sent.push(payload);
    }
    // Helper for tests.
    inject(frame) { this.onMessage?.(frame); }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred, timeoutMs = 2000, tickMs = 10) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (pred()) return true;
        await sleep(tickMs);
    }
    return false;
}

function ok(msg) { console.log(`OK: ${msg}`); }
function fail(msg, detail) {
    console.error(`FAIL: ${msg}`);
    if (detail !== undefined) console.error(detail);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

const transport = new MockTransport();

let connectFired = 0;
let errorFired   = 0;

const openlcb = await OpenLcb.create({
    transport,
    callbacks: {
        onTransportConnect:    () => { connectFired++; },
        onTransportError:      () => { errorFired++; },
    },
});
ok('OpenLcb.create() resolved');

// Runtime codec namespaces should be present.
assert.equal(typeof openlcb.float16.fromFloat,       'function', 'openlcb.float16.fromFloat missing');
assert.equal(typeof openlcb.broadcastTime.makeClockId,'function', 'openlcb.broadcastTime.makeClockId missing');
assert.equal(typeof openlcb.dccDetector.encodeEventId,'function', 'openlcb.dccDetector.encodeEventId missing');
assert.equal(typeof openlcb.trainSearch.createEventId,'function', 'openlcb.trainSearch.createEventId missing');
assert.equal(typeof openlcb.util.generateEventRangeId,'function', 'openlcb.util.generateEventRangeId missing');
ok('codec namespaces present on runtime');

// Float16 round-trip sanity.
const half = openlcb.float16.fromFloat(0.5);
const back = openlcb.float16.toFloat(half);
assert.ok(Math.abs(back - 0.5) < 1e-3, `float16 round-trip 0.5 → ${back}`);
ok(`openlcb.float16 round-trips 0.5 (half=0x${half.toString(16)})`);

// Build a minimal node.
let pcerReceived = null;
let loginCbFired = false;
const node = openlcb.createNode(0x050101010707n, {
    protocolSupport: [PSI.EVENT_EXCHANGE, PSI.SIMPLE_NODE_INFORMATION],
    producerCountAutocreate: 2,
    consumerCountAutocreate: 2,
    snip: {
        mfgVersion: 4,
        name: 'SmokeTest',
        model: 'WrapperSmoke',
        hardwareVersion: 'hw0.1',
        softwareVersion: 'sw0.1',
        userVersion: 2,
    },
}, {
    onLoginComplete: () => { loginCbFired = true; },
    onPcEventReport: (n, eid) => { pcerReceived = eid; },
});
ok(`createNode returned handle (id=${node.id.toString(16)})`);
assert.equal(node.id, 0x050101010707n);
assert.ok(node.loginComplete instanceof Promise, 'node.loginComplete should be a Promise');

// Start — runs the pump, connects transport.
await openlcb.start();
assert.equal(connectFired, 1, 'onTransportConnect should fire exactly once');
ok('openlcb.start() resolved, transport connected');

// Wait for login.
await Promise.race([
    node.loginComplete,
    sleep(2000).then(() => { throw new Error('login timeout'); }),
]);
ok('node.loginComplete Promise resolved');
assert.ok(loginCbFired, 'onLoginComplete callback should have fired');

// Login should have emitted CID/RID/AMD/Initialization Complete.
assert.ok(transport.sent.length >= 5, `expected >= 5 login frames, got ${transport.sent.length}`);
const joined = transport.sent.join('');
assert.ok(/:X170[0-7]/.test(joined), 'no CID frame found');
assert.ok(/:X10700/.test(joined),    'no RID frame found');
assert.ok(/:X10701/.test(joined),    'no AMD frame found');
assert.ok(/:X19100/.test(joined),    'no Initialization Complete frame found');
ok('login frames present (CID + RID + AMD + Initialization Complete)');

// Each outbound chunk should end with \n (frame terminator).
for (const chunk of transport.sent) {
    assert.ok(String(chunk).endsWith('\n'), `chunk missing terminator: ${chunk}`);
}
ok('every outbound chunk ends with \\n');

// Send a PCER — should throw nothing, emit one frame.
const beforeSend = transport.sent.length;
node.sendPcer(0x0101000000000042n);
await waitUntil(() => transport.sent.length > beforeSend, 500);
const newFrames = transport.sent.slice(beforeSend);
assert.ok(newFrames.some((f) => /:X195B4.*0101000000000042/.test(f)),
    `expected PCER frame, got: ${newFrames.join(', ')}`);
ok('node.sendPcer emitted a PCER frame');

// Allocate a second node with CDI bytes to exercise the params.js
// .cdi staging path (wasm_node_set_cdi).  Two flavors: Uint8Array
// directly, and a string that the wrapper UTF-8 encodes for us.
const cdiBytes = new TextEncoder().encode(
    '<?xml version="1.0"?><cdi><identification><manufacturer>X</manufacturer></identification></cdi>',
);
const nodeWithCdi = openlcb.createNode(0x050101010708n, {
    protocolSupport: [PSI.EVENT_EXCHANGE, PSI.SIMPLE_NODE_INFORMATION],
    snip: { mfgVersion: 4, name: 'CdiTest', model: 'BytesPath',
            hardwareVersion: '0.1', softwareVersion: '0.1', userVersion: 2 },
    addressSpaceConfigurationDefinitionInfo: {
        present: true, readOnly: true, highestAddress: cdiBytes.length - 1,
    },
    cdi: cdiBytes,
}, { onLoginComplete: () => {} });
assert.equal(nodeWithCdi.id, 0x050101010708n);
ok('createNode with cdi:Uint8Array succeeded');

const nodeWithCdiStr = openlcb.createNode(0x050101010709n, {
    protocolSupport: [PSI.EVENT_EXCHANGE, PSI.SIMPLE_NODE_INFORMATION],
    snip: { mfgVersion: 4, name: 'CdiTest', model: 'StringPath',
            hardwareVersion: '0.1', softwareVersion: '0.1', userVersion: 2 },
    addressSpaceConfigurationDefinitionInfo: {
        present: true, readOnly: true, highestAddress: 100,
    },
    cdi: '<?xml version="1.0"?><cdi><identification/></cdi>',
}, { onLoginComplete: () => {} });
assert.equal(nodeWithCdiStr.id, 0x050101010709n);
ok('createNode with cdi:string succeeded');

// Stop.
await openlcb.stop();
assert.equal(transport.connected, false, 'transport should be disconnected after stop()');
ok('openlcb.stop() closed the transport');

console.log('\nwrapper_smoke: all assertions passed');

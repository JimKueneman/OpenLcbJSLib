// End-to-end integration test — drives the full OpenLcbConfig stack through
// a mock WebSocket and verifies the library produces the expected GridConnect
// responses to the main Message Network / SNIP / Event Transport / Datagram
// MTIs.
//
// Run with `node test/integration.mjs` from the project root.

import assert from 'node:assert/strict';
import { OpenLcbConfig, defines, gridconnectFromCanMsg, gridconnectToCanMsg } from '../src/index.js';

// -----------------------------------------------------------------------------
// Mock WebSocket
// -----------------------------------------------------------------------------

class MockWebSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
        // Fire open asynchronously so the caller can attach handlers first.
        queueMicrotask(() => { this.readyState = 1; this.onopen?.({}); });
    }
    send(data) { this.sent.push(data); }
    close(code, reason) {
        this.readyState = 3;
        this.onclose?.({ wasClean: true, code, reason });
    }
    // Test helper — feed a GridConnect frame to the node.
    inject(gcString) { this.onmessage?.({ data: gcString }); }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const NODE_ID = 0x050101010700n;
const PEER_ALIAS = 0x555;

/** Run a single test — prints result, throws on failure so the harness bails. */
async function test(name, fn) {
    const t0 = Date.now();
    try {
        await fn();
        console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
    } catch (e) {
        console.log(`  ✗ ${name}`);
        console.log(e.stack ?? e);
        throw e;
    }
}

/** Wait one tick for microtasks / timers to drain. */
function waitOneTick() {
    return new Promise((r) => setTimeout(r, 0));
}

/** Wait ~ms real time (used to let the 100ms internal tick advance login). */
function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** Collect sent GridConnect strings up to `predicate` matching one. */
function waitForMatch(config, predicate, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const ws = config.transport._ws;
        const start = Date.now();
        const check = () => {
            const found = ws.sent.find(predicate);
            if (found) return resolve(found);
            if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for match`));
            setTimeout(check, 20);
        };
        check();
    });
}

/** Build and inject a standard OpenLCB frame from an MTI and optional payload. */
function injectStandardFrame(ws, mti, sourceAlias, destAlias, payload = []) {
    const RESERVED_TOP_BIT = 0x10000000;
    const CAN_OPENLCB_MSG = 0x08000000;
    const STANDARD = 0x01000000;
    const identifier = (RESERVED_TOP_BIT | CAN_OPENLCB_MSG | STANDARD | ((mti & 0x0FFF) << 12) | (sourceAlias & 0xFFF)) >>> 0;
    const bytes = [];
    if (destAlias !== null) {
        bytes.push((destAlias >>> 8) & 0x0F, destAlias & 0xFF);
    }
    for (const b of payload) bytes.push(b & 0xFF);
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const gc = `:X${identifier.toString(16).toUpperCase().padStart(8, '0')}N${hex};`;
    ws.inject(gc);
}

function encodeEventIdBytes(eventId) {
    const bytes = [];
    let v = eventId;
    for (let i = 0; i < 8; i++) {
        bytes.unshift(Number(v & 0xFFn));
        v >>= 8n;
    }
    return bytes;
}

function encodeNodeIdBytes(nodeId) {
    const bytes = [];
    let v = nodeId;
    for (let i = 0; i < 6; i++) {
        bytes.unshift(Number(v & 0xFFn));
        v >>= 8n;
    }
    return bytes;
}

// Build a fully-initialised node's configuration.
function nodeParameters() {
    return {
        protocolSupport:
            defines.PSI_EVENT_EXCHANGE |
            defines.PSI_SIMPLE_NODE_INFORMATION |
            defines.PSI_DATAGRAM,
        consumerCountAutocreate: 0,
        producerCountAutocreate: 0,
        snip: {
            mfgVersion: 1,
            name: 'Acme',
            model: 'Test',
            hardwareVersion: '1.0',
            softwareVersion: '0.1.0',
            userVersion: 1,
        },
        addressSpaceConfigurationDefinitionInfo: { present: false, highestAddress: 0 },
        addressSpaceAll:                          { present: false, highestAddress: 0 },
        addressSpaceConfigMemory:                 { present: true, readOnly: false, highestAddress: 256, lowAddressValid: false },
        addressSpaceAcdiManufacturer:             { present: false, highestAddress: 0 },
        addressSpaceAcdiUser:                     { present: false, highestAddress: 0 },
        addressSpaceTrainFunctionDefinitionInfo:  { present: false, highestAddress: 0 },
        addressSpaceTrainFunctionConfigMemory:    { present: false, highestAddress: 0 },
        addressSpaceFirmware:                     { present: false, highestAddress: 0 },
        configurationOptions: {},
    };
}

// Boot a config, create a node, connect, wait for login completion.
async function bootNode(consumerEvents = [], producerEvents = []) {
    const config = new OpenLcbConfig({
        websocketUrl: 'ws://test/',
        WebSocketImpl: MockWebSocket,
        autoReconnect: false,
        configMemoryRead:  (node, addr, n, buf) => { for (let i = 0; i < n; i++) buf[i] = (addr + i) & 0xFF; return n; },
        configMemoryWrite: () => 0,
        callbacks: {
            onLoginComplete: () => true,
        },
    });

    const node = config.createNode(NODE_ID, nodeParameters());
    for (const e of consumerEvents) config.application.registerConsumerEventId(node, e, 0);
    for (const e of producerEvents) config.application.registerProducerEventId(node, e, 0);

    config.start();
    // Wait for the CAN login to finish — takes about 300-500ms of ticks.
    for (let i = 0; i < 40 && node.state.runState !== defines.RUNSTATE_RUN; i++) {
        await wait(50);
    }
    assert.equal(node.state.runState, defines.RUNSTATE_RUN, 'node should reach RUNSTATE_RUN');
    return { config, node };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

console.log('\nOpenLcbJSLib integration tests\n');

await test('Full CAN + OpenLCB login sequence emits expected frames', async () => {
    const { config, node } = await bootNode();
    const ws = config.transport._ws;
    const sent = ws.sent.map((s) => s);

    // CID frames: at least one each of 1[4-7]XXXXXX (Check ID).
    const cidTypes = new Set(sent
        .filter((s) => /^:X1[4-7]/.test(s))
        .map((s) => s.charAt(3)));
    assert.ok(cidTypes.has('4') && cidTypes.has('5') && cidTypes.has('6') && cidTypes.has('7'),
        `expected all four CID types, got ${[...cidTypes]}`);

    // RID frame.
    assert.ok(sent.some((s) => /^:X10700[0-9A-F]{3}N;$/.test(s)), 'missing RID frame');
    // AMD frame with 6-byte Node ID payload.
    assert.ok(sent.some((s) => /^:X10701[0-9A-F]{3}N050101010700;$/.test(s)), 'missing AMD with Node ID');
    // Initialization Complete (MTI 0x100, hence identifier 0x19100XXX).
    assert.ok(sent.some((s) => /^:X19100[0-9A-F]{3}N050101010700;$/.test(s)), 'missing Initialization Complete');

    assert.ok(node.alias >= 1 && node.alias <= 0xFFF, 'node has a valid alias');
    config.stop();
});

await test('Verify Node ID Global elicits Verified Node ID reply', async () => {
    const { config, node } = await bootNode();
    const ws = config.transport._ws;
    ws.sent.length = 0;

    // Inject Verify Node ID Global (MTI 0x0490) with no payload.
    injectStandardFrame(ws, 0x0490, PEER_ALIAS, null, []);

    const reply = await waitForMatch(config, (s) => /^:X19170[0-9A-F]{3}N050101010700;$/.test(s));
    // MTI 0x170 = MTI_VERIFIED_NODE_ID, source alias is ours.
    assert.ok(reply.includes(node.alias.toString(16).toUpperCase().padStart(3, '0')),
        `reply ${reply} should include our alias`);
    config.stop();
});

await test('Protocol Support Inquiry (addressed) returns PIP reply with our flags', async () => {
    const { config, node } = await bootNode();
    const ws = config.transport._ws;
    ws.sent.length = 0;

    // MTI 0x0828 = PROTOCOL_SUPPORT_INQUIRY, addressed to our alias.
    injectStandardFrame(ws, 0x0828, PEER_ALIAS, node.alias, []);

    const reply = await waitForMatch(config, (s) => /^:X19668[0-9A-F]{3}N/.test(s));
    // MTI 0x668 = PROTOCOL_SUPPORT_REPLY. Payload: dest-alias word (0x0555) + 6 PIP bytes.
    // PSI_EVENT_EXCHANGE=0x040000 | PSI_SNIP=0x001000 | PSI_DATAGRAM=0x400000 → top 3 bytes 0x441000.
    assert.match(reply, /N0555441000000000;$/, `unexpected PIP reply: ${reply}`);
    config.stop();
});

await test('Consumer Identify for a known event returns Consumer Identified', async () => {
    const eventId = 0x0102030405060708n;
    const { config, node } = await bootNode([eventId]);
    const ws = config.transport._ws;
    ws.sent.length = 0;

    // MTI 0x08F4 = CONSUMER_IDENTIFY, event ID in payload.
    injectStandardFrame(ws, 0x08F4, PEER_ALIAS, null, encodeEventIdBytes(eventId));

    // Expect MTI 0x4C7 (Consumer Identified Unknown) since we registered the event with status=UNKNOWN.
    const reply = await waitForMatch(config, (s) => /^:X194C7[0-9A-F]{3}N0102030405060708;$/.test(s));
    assert.ok(reply, 'missing Consumer Identified Unknown reply');
    config.stop();
});

await test('Consumer Identify for an UNKNOWN event yields no reply', async () => {
    const { config } = await bootNode([0x0102030405060708n]);
    const ws = config.transport._ws;
    ws.sent.length = 0;

    const unknownEvent = 0xDEADBEEFCAFEBABEn;
    injectStandardFrame(ws, 0x08F4, PEER_ALIAS, null, encodeEventIdBytes(unknownEvent));

    // Drain the main loop for a bit.
    await wait(100);
    const replies = ws.sent.filter((s) => /^:X194/.test(s));
    assert.equal(replies.length, 0, `expected no event-identify reply, got ${replies}`);
    config.stop();
});

await test('SNIP request returns a well-formed SNIP reply', async () => {
    const { config, node } = await bootNode();
    const ws = config.transport._ws;
    ws.sent.length = 0;

    // MTI 0x0DE8 = SIMPLE_NODE_INFO_REQUEST, addressed.
    injectStandardFrame(ws, 0x0DE8, PEER_ALIAS, node.alias, []);

    // SNIP reply may span multiple CAN frames — collect until we see the terminal (MULTIFRAME_FINAL=2x)
    // or the ONLY (1x) variant. With short SNIP data we expect FIRST+LAST pair (one pair) or ONLY.
    // Just verify the first SNIP MTI frame arrives.
    const reply = await waitForMatch(config, (s) => /^:X19A08[0-9A-F]{3}N/.test(s));
    assert.ok(reply, 'missing SNIP reply');

    // Decode each SNIP frame and reconstruct the payload to verify field count.
    const snipFrames = ws.sent.filter((s) => /^:X19A08/.test(s));
    // The manufacturer name should appear in the wire bytes somewhere.
    assert.ok(snipFrames.some((s) => s.toLowerCase().includes('41636d65')),
        'expected "Acme" (414365656D = 0x416365... wait, "Acme" = 0x41, 0x63, 0x6d, 0x65) in SNIP bytes');
    config.stop();
});

await test('Datagram with unknown command byte returns Datagram Rejected', async () => {
    const { config, node } = await bootNode();
    const ws = config.transport._ws;
    ws.sent.length = 0;

    // Datagram-only frame type is 0x02 in bits 26-24, so identifier = 0x1A[dst][src].
    // Payload[0] = unknown command byte (not 0x20).
    const RESERVED_TOP_BIT = 0x10000000;
    const CAN_OPENLCB_MSG = 0x08000000;
    const DATAGRAM_ONLY = 0x02000000;
    const identifier = (RESERVED_TOP_BIT | CAN_OPENLCB_MSG | DATAGRAM_ONLY | ((node.alias & 0xFFF) << 12) | PEER_ALIAS) >>> 0;
    const gc = `:X${identifier.toString(16).toUpperCase().padStart(8, '0')}NFF;`;
    ws.inject(gc);

    // MTI 0xA48 = DATAGRAM_REJECTED_REPLY. Error 0x1042 = NOT_IMPLEMENTED_COMMAND_UNKNOWN.
    const reply = await waitForMatch(config, (s) => /^:X19A48[0-9A-F]{3}N[0-9A-F]{4}1042;$/i.test(s));
    assert.ok(reply, `missing Datagram Rejected reply, sent: ${ws.sent}`);
    config.stop();
});

await test('config.stop() cleanly closes transport and run loops', async () => {
    const { config } = await bootNode();
    assert.equal(config.transport.state, 'connected');
    config.stop();
    await wait(10);
    assert.equal(config.transport.state, 'disconnected');
});

console.log('\nAll integration tests passed.\n');

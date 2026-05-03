// ============================================================================
// register_events.js  —  Event registration helper
// ============================================================================
//
// HOW TO USE
// ----------
//
//      const lib  = await OpenLcb.create({ /* transport options */ });
//      const node = lib.createNode(NODE_ID, OpenLcbUserConfig_node_parameters);
//      registerEvents(node);
//
// For a Broadcast Clock generator there is little to register here — the
// per-clock Producer/Consumer Range Identified messages required by spec
// Section 6.1 are emitted by the library itself when the application calls
// `node.broadcastTime.setupProducer(clockId)`.  That call happens
// dynamically (post-login) once the configured clock ID is known, so this
// helper stays empty by design.
//
// Generated from the throttle template — Copyright (c) 2026, Jim Kueneman
// <YOUR LICENSE TEXT HERE>

// Imports kept for parity with the wizard template, even though the body
// of registerEvents() is currently empty for a clock generator.
// eslint-disable-next-line no-unused-vars
import { Event, EventStatus, EventRangeCount } from '../../src/openlcb/constants.js';

export function registerEvents(_node) {

    // -------------------------------------------------------------------
    // Producers
    // -------------------------------------------------------------------
    //
    // The broadcast clock's producer/consumer registrations are owned by
    // the WASM library and emitted in response to setupProducer(clockId).
    // No static registrations are needed here.

    // -------------------------------------------------------------------
    // Consumers
    // -------------------------------------------------------------------
    //
    // A clock generator may optionally listen for general well-known
    // events (e.g. EMERGENCY_OFF) to drive UI cues, but none are required
    // by BroadcastTimeS.  Add them here if desired.

}

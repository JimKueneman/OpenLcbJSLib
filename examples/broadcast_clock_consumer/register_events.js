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
// For a Broadcast Clock display (consumer) there is little to register here —
// the per-clock Consumer Range Identified message required by spec
// Section 6.1 is emitted by the library itself when the application calls
// `node.broadcastTime.setupConsumer(clockId)`.  That call happens
// dynamically (post-login) once the configured clock ID is known, so this
// helper stays empty by design.
//
// Generated from the throttle template — Copyright (c) 2026, Jim Kueneman
// <YOUR LICENSE TEXT HERE>

// eslint-disable-next-line no-unused-vars
import { Event, EventStatus, EventRangeCount } from '../../src/openlcb/constants.js';

export function registerEvents(_node) {

    // -------------------------------------------------------------------
    // Producers
    // -------------------------------------------------------------------
    //
    // A pure clock display does not produce well-known events. Set/Query
    // commands sent from the UI ride the broadcastTime facade, which
    // routes through the library's producer registration.

    // -------------------------------------------------------------------
    // Consumers
    // -------------------------------------------------------------------
    //
    // The broadcast clock's Consumer Range Identified is emitted by the
    // WASM library in response to setupConsumer(clockId).  No static
    // registrations are needed here.

}

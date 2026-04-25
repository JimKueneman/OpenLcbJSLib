// =============================================================================
// openlcb_user_config.js — Train Command Station example, root node
// =============================================================================
//
// Mirror of OpenLcbCLib's openlcb_user_config.c pattern, ported to JS.
// This file describes the CS's own root node (SNIP identity, source
// for global emergency PCERs).  Per-virtual-train nodes are described
// by train_user_config.js.
//
// No CDI today — operator-configurable CS-level options (default
// heartbeat, base node ID, allocate-on-search policy) will land in a
// future cdi.xml + regenerated openlcb_user_config.js.

import { PSI } from '../../src/openlcb/constants.js';

// -----------------------------------------------------------------------------
// Default base Node ID for the connect form.  The CS root logs in at
// this address; per-train nodes are namespaced under it (see
// train_user_config.js — trainNodeId(addr) = NODE_ID | BigInt(addr)).
// -----------------------------------------------------------------------------

export const NODE_ID = 0x050101010800n;

export const OpenLcbUserConfig_node_parameters = {

    // 1. snip
    snip: {
        mfgVersion:      4,
        name:            'OpenLcbJSLib',
        model:           'Command Station',
        hardwareVersion: '1.0',
        softwareVersion: '0.1',
        userVersion:     2,
    },

    // 2. protocol_support
    protocolSupport: [
        PSI.EVENT_EXCHANGE,
        PSI.SIMPLE_NODE_INFORMATION,
    ],

    consumerCountAutocreate: 0,
    producerCountAutocreate: 0,

    configurationOptions: {},

    cdi: null,
    fdi: null,
};

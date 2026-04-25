// =============================================================================
// openlcb_user_config.js — Train Throttle example
// =============================================================================
//
// Mirror of OpenLcbCLib's openlcb_user_config.c pattern, ported to JS.
// The throttle is a pure event sender/receiver — it does NOT advertise
// PSI.TRAIN_CONTROL (that would falsely announce the throttle as a train
// on the bus) and it has no user-configurable memory, so .cdi and .fdi
// stay null.  Once a CDI is needed (for example to expose a "throttle
// nickname" config field) it will be hand-derived from a sibling cdi.xml
// the same way openlcb.bundle.js / basic_node does today.

import { PSI } from '../../src/openlcb/constants.js';

// -----------------------------------------------------------------------------
// Default Node ID for the connect form.  Operator can override before connect.
// -----------------------------------------------------------------------------

export const NODE_ID = 0x050101010707n;

// -----------------------------------------------------------------------------
// Node parameters — mirror of OpenLcbUserConfig_node_parameters in the
// CLib applications/.../openlcb_user_config.c file.  Identifier name
// matches the C identifier letter-for-letter.
// -----------------------------------------------------------------------------

export const OpenLcbUserConfig_node_parameters = {

    // 1. snip
    snip: {
        mfgVersion:      4,
        name:            'OpenLcbJSLib',
        model:           'Phone Throttle',
        hardwareVersion: '1.0',
        softwareVersion: '0.1',
        userVersion:     2,
    },

    // 2. protocol_support — Event Exchange + SNIP only.  No PSI.TRAIN_CONTROL
    //    here on purpose; the throttle drives trains, it isn't one.
    protocolSupport: [
        PSI.EVENT_EXCHANGE,
        PSI.SIMPLE_NODE_INFORMATION,
    ],

    // 3-4. event auto-create counts
    consumerCountAutocreate: 0,
    producerCountAutocreate: 0,

    // 5. configuration_options — none
    configurationOptions: {},

    // 14-15. cdi / fdi — none today
    cdi: null,
    fdi: null,
};

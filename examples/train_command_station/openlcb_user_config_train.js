// =============================================================================
// openlcb_user_config_train.js — per-virtual-train parameters factory
// =============================================================================
//
// Each virtual locomotive the CS hosts is its own OpenLCB train node.
// The factory makeTrainNodeParameters(opts) builds the createNode()
// parameters for one train at runtime — DCC address dictates the SNIP
// name and the low bits of the Node ID.
//
// Naming convention: when an example hosts more than one node type, all
// per-type files take the openlcb_user_config_<type>.js suffix
// (cdi_<type>.xml / fdi_<type>.xml when those XMLs land).  This file is
// the "train" virtual-node-type; openlcb_user_config_command_station.js
// is the "command_station" host-root config.  An example with only one
// node type stays unsuffixed (openlcb_user_config.js + cdi.xml + fdi.xml).
//
// Once an FDI XML lands (function-label metadata served from address
// space 0xFA), this file becomes the artifact emitted from a sibling
// fdi_train.xml in the same way openlcb_user_config_command_station.js
// will be hand-derived from cdi_command_station.xml.

import { PSI } from '../../src/openlcb/constants.js';
import { NODE_ID as CS_BASE_NODE_ID } from './openlcb_user_config_command_station.js';

// -----------------------------------------------------------------------------
// Train Node ID derivation.  Namespaces every virtual train under the CS
// base ID so the CS can recover its roster across restarts: train node
// for DCC 7 is `<CS base> | 7`.
// -----------------------------------------------------------------------------

export function trainNodeId(dccAddress) {

    return CS_BASE_NODE_ID | BigInt(dccAddress);

}

// -----------------------------------------------------------------------------
// Parameters factory.  Identifier shape mirrors the C-side pattern; the
// "user config" here is per-train rather than fixed-at-compile-time
// because the CS allocates trains dynamically on demand.
// -----------------------------------------------------------------------------

/**
 * Build createNode() parameters for one virtual train.
 *
 * @param {object} opts
 * @param {number} opts.addr   DCC address (1..10239).
 * @param {boolean} [opts.long]  Long DCC addressing.  Defaults to false.
 * @param {number}  [opts.steps] Speed-step preference (14, 28, or 128). Default 128.
 * @param {string}  [opts.name]  SNIP user name.  Default `DCC <addr>`.
 * @return {object} Parameters object suitable for openlcb.createNode(...).
 */
export function makeTrainNodeParameters({ addr, long = false, steps = 128, name } = {}) {

    return {

        // 1. snip
        snip: {
            mfgVersion:      4,
            name:            name || `DCC ${addr}${long ? ' (long)' : ''}`,
            model:           'Virtual Train',
            hardwareVersion: '1.0',
            softwareVersion: '0.1',
            userVersion:     2,
        },

        // 2. protocol_support — PSI.TRAIN_CONTROL triggers automatic
        //    train_state allocation in the wrapper.
        protocolSupport: [
            PSI.EVENT_EXCHANGE,
            PSI.SIMPLE_NODE_INFORMATION,
            PSI.TRAIN_CONTROL,
        ],

        consumerCountAutocreate: 0,
        producerCountAutocreate: 0,

        configurationOptions: {},

        // FDI 0xFA will land here once the FDI generator exists.
        cdi: null,
        fdi: null,

        // Echo back addressing knobs so the CS app can call
        // setDccAddress / setSpeedSteps without re-deriving them.
        _train: { addr, long, steps },

    };

}

// ============================================================================
// openlcb_user_config.js  —  Broadcast Clock Display (Consumer) Node
// ============================================================================
//
// Mirrors the OpenLcbCLib openlcb_user_config.c pattern, written as an ESM
// module consumed by openlcb.createNode() in the WASM wrapper.  The CDI XML
// is kept inline as a template literal — at module load TextEncoder converts
// it (plus a NUL terminator, matching the C convention) into the Uint8Array
// the library hands to the WASM builder.
//
// Copyright (c) 2026, Jim Kueneman
// <YOUR LICENSE TEXT HERE>

import { PSI } from '../../src/openlcb/constants.js';

// ----------------------------------------------------------------------------
// 48-bit OpenLCB Node ID — distinct from the producer example (…0608) so
// both can be loaded against the same hub for end-to-end testing.
// ----------------------------------------------------------------------------

export const NODE_ID = 0x020304050609n;

// ----------------------------------------------------------------------------
// CDI (Configuration Description Information) — UTF-8 + NUL terminator.
// ----------------------------------------------------------------------------

const _cdi_clock_consumer_xml = `<?xml version="1.0"?>
<cdi xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://openlcb.org/schema/cdi/1/4/cdi.xsd">
  <identification>
    <manufacturer>Mustangpeak</manufacturer>
    <model>Broadcast Clock Display</model>
    <hardwareVersion>0.1</hardwareVersion>
    <softwareVersion>0.1</softwareVersion>
  </identification>
  <acdi/>
  <segment space="253" origin="0">
    <name>User Identification</name>
    <group>
      <name>User Identification</name>
      <description>User-assigned name and description for this node</description>
      <string size="62">
        <name>Node Name</name>
        <description>Short user-assigned name (max 62 characters)</description>
      </string>
      <string size="63">
        <name>Node Description</name>
        <description>Longer description of this node (max 63 characters)</description>
      </string>
    </group>
  </segment>
  <segment space="253" origin="128">
    <name>Configuration</name>
    <group>
      <name>Configuration</name>
      <description>Node configuration settings</description>
    </group>
  </segment>
</cdi>
`;

const _cdi_clock_consumer_data = (() => {
    const body = new TextEncoder().encode(_cdi_clock_consumer_xml);
    const out = new Uint8Array(body.length + 1);
    out.set(body);
    out[body.length] = 0;
    return out;
})();

// ----------------------------------------------------------------------------
// Node parameters — keys mirror node_parameters_t in openlcb_types.h.
// ----------------------------------------------------------------------------

export const OpenLcbUserConfig_node_parameters = {

    snip: {
        mfgVersion:      4,
        name:            'Mustangpeak',
        model:           'Broadcast Clock Display',
        hardwareVersion: '0.1',
        softwareVersion: '0.1',
        userVersion:     2,
    },

    // Clock display is a passive event consumer — same protocol set as the
    // producer (datagram for memory-config, event exchange for the time
    // events themselves).  No PSI.TRAIN_CONTROL or PSI.STREAM.
    protocolSupport: [
        PSI.DATAGRAM,
        PSI.MEMORY_CONFIGURATION,
        PSI.EVENT_EXCHANGE,
        PSI.SIMPLE_NODE_INFORMATION,
        PSI.ABBREVIATED_DEFAULT_CDI,
        PSI.CONFIGURATION_DESCRIPTION_INFO,
    ],

    consumerCountAutocreate: 0,
    producerCountAutocreate: 0,

    configurationOptions: {
        readFromManufacturerSpace0xfcSupported: true,
        readFromUserSpace0xfbSupported:         true,
        writeToUserSpace0xfbSupported:          true,
        highestAddressSpace:                    0xFF,
        lowestAddressSpace:                     0xFB,
    },

    addressSpaceConfigurationDefinitionInfo: {
        present:         true,
        readOnly:        true,
        lowAddressValid: false,
        highestAddress:  _cdi_clock_consumer_data.length - 1,
        description:     'Configuration Description Information',
    },

    addressSpaceAll: {
        present:         false,
        readOnly:        true,
        lowAddressValid: false,
        highestAddress:  0xFFFFFFFF,
        description:     'All Memory (debug)',
    },

    addressSpaceConfigMemory: {
        present:         true,
        readOnly:        false,
        lowAddressValid: false,
        highestAddress:  256,
        description:     'Configuration Memory',
    },

    addressSpaceAcdiManufacturer: {
        present:         true,
        readOnly:        true,
        lowAddressValid: false,
        highestAddress:  124,
        description:     'ACDI manufacturer access',
    },

    addressSpaceAcdiUser: {
        present:         true,
        readOnly:        false,
        lowAddressValid: false,
        highestAddress:  127,
        description:     'ACDI user access',
    },

    addressSpaceTrainFunctionDefinitionInfo: {
        present:         false,
        readOnly:        true,
        lowAddressValid: false,
        highestAddress:  0,
        description:     'Train FDI',
    },

    addressSpaceTrainFunctionConfigMemory: {
        present:         false,
        readOnly:        false,
        lowAddressValid: false,
        highestAddress:  0,
        description:     'Train function config memory',
    },

    addressSpaceFirmware: {
        present:         false,
        readOnly:        false,
        lowAddressValid: false,
        highestAddress:  0xFFFFFFFF,
        description:     'Firmware upgrade',
    },

    cdi: _cdi_clock_consumer_data,
    fdi: null,
};

// ============================================================================
// openlcb_user_config.js  —  Broadcast Clock Generator Node
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
// 48-bit OpenLCB Node ID (BigInt literal — note the trailing `n`).
// ----------------------------------------------------------------------------

export const NODE_ID = 0x020304050608n;

// ----------------------------------------------------------------------------
// CDI (Configuration Description Information) — UTF-8 + NUL terminator.
// Configuration tools read this as a NUL-terminated string.
// ----------------------------------------------------------------------------

const _cdi_clock_source_xml = `<?xml version="1.0"?>
<cdi xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://openlcb.org/schema/cdi/1/4/cdi.xsd">
  <identification>
    <manufacturer>Mustangpeak</manufacturer>
    <model>Broadcast Clock Generator</model>
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

const _cdi_clock_source_data = (() => {
    const body = new TextEncoder().encode(_cdi_clock_source_xml);
    const out = new Uint8Array(body.length + 1);
    out.set(body);
    out[body.length] = 0;   // NUL terminator — config tools read CDI as a C string
    return out;
})();

// ----------------------------------------------------------------------------
// Node parameters — keys mirror node_parameters_t in openlcb_types.h.
// ----------------------------------------------------------------------------

export const OpenLcbUserConfig_node_parameters = {

    // 1. snip — mfgVersion/userVersion are spec-fixed string counts
    snip: {
        mfgVersion:      4,
        name:            'Mustangpeak',
        model:           'Broadcast Clock Generator',
        hardwareVersion: '0.1',
        softwareVersion: '0.1',
        userVersion:     2,
    },

    // 2. protocolSupport — clock generator is an event sender/receiver only.
    // No PSI.TRAIN_CONTROL; no PSI.STREAM.
    protocolSupport: [
        PSI.DATAGRAM,
        PSI.MEMORY_CONFIGURATION,
        PSI.EVENT_EXCHANGE,
        PSI.SIMPLE_NODE_INFORMATION,
        PSI.ABBREVIATED_DEFAULT_CDI,
        PSI.CONFIGURATION_DESCRIPTION_INFO,
    ],

    // 3-4. event auto-create counts — handled explicitly via setupProducer().
    consumerCountAutocreate: 0,
    producerCountAutocreate: 0,

    // 5. configurationOptions — capability flags advertised to peers
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
        highestAddress:  _cdi_clock_source_data.length - 1,
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

    // 14-15. cdi / fdi — Uint8Array (or string, both accepted).  No FDI here.
    cdi: _cdi_clock_source_data,
    fdi: null,
};

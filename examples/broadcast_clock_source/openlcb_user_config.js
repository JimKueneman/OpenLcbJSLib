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
// Configuration memory layout — offsets into address space 0xFD.
//
// 0..124  : ACDI user name (62) + description (63), per ACDI convention.
// 128..   : Clock generator configuration (matches cdi_clock_source.xml).
//
// Exposed so the application code can read/write these fields without
// duplicating the layout constants.
// ----------------------------------------------------------------------------

export const CONFIG_OFFSETS = Object.freeze({
    USER_NAME:           0,    // 62 bytes
    USER_DESCRIPTION:    62,   // 63 bytes

    CLOCK_ID_INDEX:      128,  // u8 — 0..3 well-known, 4 = use CUSTOM_CLOCK_ID
    CUSTOM_CLOCK_ID:     129,  // 6 bytes, big-endian (48-bit OpenLCB ID)
    AUTO_START:          135,  // u8 — 0 stopped, 1 running
    INITIAL_HOUR:        136,  // u8 0..23
    INITIAL_MINUTE:      137,  // u8 0..59
    INITIAL_MONTH:       138,  // u8 1..12
    INITIAL_DAY:         139,  // u8 1..31
    INITIAL_YEAR:        140,  // u16 BE, 0..4095
    INITIAL_RATE_RAW:    142,  // i16 BE — 12-bit signed fixed-point per spec §4.4
});

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
    <name>Clock Configuration</name>
    <group>
      <name>Clock Identity</name>
      <description>Selects which 6-byte Specific Upper Part this generator owns. Per BroadcastTimeS Section 4 the four well-known IDs cover the common case; pick Custom to use the 48-bit ID configured below from the manufacturer/owner unique ID space.</description>
      <int size="1">
        <name>Clock ID</name>
        <description>0 = Default Fast (01.01.00.00.01.00), 1 = Default Real-time (01.01.00.00.01.01), 2 = Alternate 1 (01.01.00.00.01.02), 3 = Alternate 2 (01.01.00.00.01.03), 4 = Custom (uses the 48-bit value below)</description>
        <map>
          <relation><property>0</property><value>Default Fast Clock</value></relation>
          <relation><property>1</property><value>Default Real-time Clock</value></relation>
          <relation><property>2</property><value>Alternate Clock 1</value></relation>
          <relation><property>3</property><value>Alternate Clock 2</value></relation>
          <relation><property>4</property><value>Custom (use 48-bit ID below)</value></relation>
        </map>
      </int>
      <int size="6">
        <name>Custom Clock ID (48-bit)</name>
        <description>Used only when Clock ID above is set to Custom. Must be a valid OpenLCB 48-bit unique ID controlled by the manufacturer or operator; collisions with the 4 reserved IDs above are not permitted.</description>
      </int>
    </group>
    <group>
      <name>Boot Defaults</name>
      <description>Values applied when the node starts. The node may diverge from these at run-time via Set events from the bus or the local UI.</description>
      <int size="1">
        <name>Auto-start</name>
        <description>0 = boot stopped, 1 = boot running. The library auto-advances modeled time only while running.</description>
        <map>
          <relation><property>0</property><value>Stopped at boot</value></relation>
          <relation><property>1</property><value>Running at boot</value></relation>
        </map>
      </int>
      <int size="1">
        <name>Initial Hour</name>
        <description>0-23 (24-hour format per spec Section 4.1)</description>
        <min>0</min><max>23</max>
      </int>
      <int size="1">
        <name>Initial Minute</name>
        <description>0-59</description>
        <min>0</min><max>59</max>
      </int>
      <int size="1">
        <name>Initial Month</name>
        <description>1-12</description>
        <min>1</min><max>12</max>
      </int>
      <int size="1">
        <name>Initial Day</name>
        <description>1-31</description>
        <min>1</min><max>31</max>
      </int>
      <int size="2">
        <name>Initial Year</name>
        <description>0-4095 AD per spec Section 4.3</description>
        <min>0</min><max>4095</max>
      </int>
      <int size="2">
        <name>Initial Rate (raw)</name>
        <description>12-bit signed fixed-point rate per spec Section 4.4: rate * 4. e.g. 4 = 1.00x, 16 = 4.00x, -4 = -1.00x. Range -2048..2047 (i.e. -512.00x..511.75x).</description>
        <min>-2048</min><max>2047</max>
      </int>
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

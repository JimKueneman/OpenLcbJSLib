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
// Configuration memory layout — offsets into address space 0xFD.
//
// 0..124  : ACDI user name (62) + description (63), per ACDI convention.
// 128..   : Clock display configuration (matches cdi_clock_consumer.xml).
// ----------------------------------------------------------------------------

export const CONFIG_OFFSETS = Object.freeze({
    USER_NAME:           0,    // 62 bytes
    USER_DESCRIPTION:    62,   // 63 bytes

    CLOCK_ID_INDEX:      128,  // u8 — 0..3 well-known, 4 = use CUSTOM_CLOCK_ID
    CUSTOM_CLOCK_ID:     129,  // 6 bytes, big-endian (48-bit OpenLCB ID)
    TIME_FORMAT:         135,  // u8 — 0 = 24-hour, 1 = 12-hour AM/PM
    AUTO_QUERY:          136,  // u8 — 0/1
    LOCAL_INTERPOLATION: 137,  // u8 — 0/1
});

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
    <name>Clock Configuration</name>
    <group>
      <name>Clock Identity</name>
      <description>Selects which 6-byte Specific Upper Part this consumer tracks. Per BroadcastTimeS Section 4 the four well-known IDs cover the common case; pick Custom to track a 48-bit ID controlled by the producer.</description>
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
        <description>Used only when Clock ID above is set to Custom. Must match the 48-bit unique ID the producer is using.</description>
      </int>
    </group>
    <group>
      <name>Display</name>
      <description>Presentation-only knobs. Per BroadcastTimeTN Section 2.4.1 the wire format is always 24-hour; the display is a node-local choice.</description>
      <int size="1">
        <name>Time Format</name>
        <description>How the big readout renders the hour.</description>
        <map>
          <relation><property>0</property><value>24-hour</value></relation>
          <relation><property>1</property><value>12-hour with AM/PM</value></relation>
        </map>
      </int>
      <int size="1">
        <name>Auto-query at login</name>
        <description>If enabled, the display sends a Query event right after login completes so the producer issues its Section 6.3 burst and the display catches up immediately rather than waiting for the next minute tick.</description>
        <map>
          <relation><property>0</property><value>Disabled</value></relation>
          <relation><property>1</property><value>Enabled</value></relation>
        </map>
      </int>
      <int size="1">
        <name>Local Interpolation</name>
        <description>If enabled, the consumer calls start() at login so the library advances time between Report Time events. Per BroadcastTimeTN Section 2.6 a clock display should keep its own internal clock to extrapolate fast-time accurately for at least one real-world hour without divergence.</description>
        <map>
          <relation><property>0</property><value>Disabled (snap on each Report)</value></relation>
          <relation><property>1</property><value>Enabled (advance locally)</value></relation>
        </map>
      </int>
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

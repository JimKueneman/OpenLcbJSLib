// Grouped constants for the public API.
//
// Values come from wasm/openlcb-defines.mjs (auto-generated from the
// OpenLcbCLib headers).  This file wraps the flat SCREAMING_SNAKE names
// into typed groupings so consumer code reads naturally:
//
//     import { PSI, MTI, AddressSpace } from 'openlcb-js-lib';
//     openlcb.createNode(id, {
//         protocolSupport: [PSI.EVENT_EXCHANGE, PSI.SIMPLE_NODE_INFORMATION],
//     });
//
// Do not hand-edit the underlying values — regenerate via
// `node wasm/generate_defines.mjs` (or run the wasm_update_wizard).

import * as D from '../../wasm/openlcb-defines.mjs';

// ---------------------------------------------------------------------------
// Protocol Support (PSI) — bitfield of supported protocols for a node.
// ---------------------------------------------------------------------------
export const PSI = Object.freeze({
    SIMPLE:                        D.PSI_SIMPLE,
    DATAGRAM:                      D.PSI_DATAGRAM,
    STREAM:                        D.PSI_STREAM,
    MEMORY_CONFIGURATION:          D.PSI_MEMORY_CONFIGURATION,
    RESERVATION:                   D.PSI_RESERVATION,
    EVENT_EXCHANGE:                D.PSI_EVENT_EXCHANGE,
    IDENTIFICATION:                D.PSI_IDENTIFICATION,
    TEACHING_LEARNING:             D.PSI_TEACHING_LEARNING,
    REMOTE_BUTTON:                 D.PSI_REMOTE_BUTTON,
    ABBREVIATED_DEFAULT_CDI:       D.PSI_ABBREVIATED_DEFAULT_CDI,
    DISPLAY:                       D.PSI_DISPLAY,
    SIMPLE_NODE_INFORMATION:       D.PSI_SIMPLE_NODE_INFORMATION,
    CONFIGURATION_DESCRIPTION_INFO: D.PSI_CONFIGURATION_DESCRIPTION_INFO,
    TRAIN_CONTROL:                 D.PSI_TRAIN_CONTROL,
    FUNCTION_DESCRIPTION:          D.PSI_FUNCTION_DESCRIPTION,
    FUNCTION_CONFIGURATION:        D.PSI_FUNCTION_CONFIGURATION,
    FIRMWARE_UPGRADE:              D.PSI_FIRMWARE_UPGRADE,
    FIRMWARE_UPGRADE_ACTIVE:       D.PSI_FIRMWARE_UPGRADE_ACTIVE,
});

// ---------------------------------------------------------------------------
// Message Type Indicator (MTI) — OpenLCB message type codes.
// ---------------------------------------------------------------------------
export const MTI = Object.freeze({
    INITIALIZATION_COMPLETE:        D.MTI_INITIALIZATION_COMPLETE,
    INITIALIZATION_COMPLETE_SIMPLE: D.MTI_INITIALIZATION_COMPLETE_SIMPLE,
    VERIFY_NODE_ID_GLOBAL:          D.MTI_VERIFY_NODE_ID_GLOBAL,
    VERIFY_NODE_ID_ADDRESSED:       D.MTI_VERIFY_NODE_ID_ADDRESSED,
    VERIFIED_NODE_ID:               D.MTI_VERIFIED_NODE_ID,
    VERIFIED_NODE_ID_SIMPLE:        D.MTI_VERIFIED_NODE_ID_SIMPLE,
    OPTIONAL_INTERACTION_REJECTED:  D.MTI_OPTIONAL_INTERACTION_REJECTED,
    TERMINATE_DUE_TO_ERROR:         D.MTI_TERMINATE_DUE_TO_ERROR,
    PROTOCOL_SUPPORT_INQUIRY:       D.MTI_PROTOCOL_SUPPORT_INQUIRY,
    PROTOCOL_SUPPORT_REPLY:         D.MTI_PROTOCOL_SUPPORT_REPLY,
    SIMPLE_NODE_INFO_REQUEST:       D.MTI_SIMPLE_NODE_INFO_REQUEST,
    SIMPLE_NODE_INFO_REPLY:         D.MTI_SIMPLE_NODE_INFO_REPLY,
    SIMPLE_TRAIN_INFO_REQUEST:      D.MTI_SIMPLE_TRAIN_INFO_REQUEST,
    SIMPLE_TRAIN_INFO_REPLY:        D.MTI_SIMPLE_TRAIN_INFO_REPLY,

    // Event Transport
    CONSUMER_IDENTIFY:              D.MTI_CONSUMER_IDENTIFY,
    CONSUMER_IDENTIFIED_SET:        D.MTI_CONSUMER_IDENTIFIED_SET,
    CONSUMER_IDENTIFIED_CLEAR:      D.MTI_CONSUMER_IDENTIFIED_CLEAR,
    CONSUMER_IDENTIFIED_RESERVED:   D.MTI_CONSUMER_IDENTIFIED_RESERVED,
    CONSUMER_IDENTIFIED_UNKNOWN:    D.MTI_CONSUMER_IDENTIFIED_UNKNOWN,
    CONSUMER_RANGE_IDENTIFIED:      D.MTI_CONSUMER_RANGE_IDENTIFIED,
    PRODUCER_IDENTIFY:              D.MTI_PRODUCER_IDENTIFY,
    PRODUCER_IDENTIFIED_SET:        D.MTI_PRODUCER_IDENTIFIED_SET,
    PRODUCER_IDENTIFIED_CLEAR:      D.MTI_PRODUCER_IDENTIFIED_CLEAR,
    PRODUCER_IDENTIFIED_RESERVED:   D.MTI_PRODUCER_IDENTIFIED_RESERVED,
    PRODUCER_IDENTIFIED_UNKNOWN:    D.MTI_PRODUCER_IDENTIFIED_UNKNOWN,
    PRODUCER_RANGE_IDENTIFIED:      D.MTI_PRODUCER_RANGE_IDENTIFIED,
    EVENTS_IDENTIFY:                D.MTI_EVENTS_IDENTIFY,
    EVENTS_IDENTIFY_DEST:           D.MTI_EVENTS_IDENTIFY_DEST,
    EVENT_LEARN:                    D.MTI_EVENT_LEARN,
    PC_EVENT_REPORT:                D.MTI_PC_EVENT_REPORT,
    PC_EVENT_REPORT_WITH_PAYLOAD:   D.MTI_PC_EVENT_REPORT_WITH_PAYLOAD,

    // Streams + Datagrams
    STREAM_INIT_REQUEST:            D.MTI_STREAM_INIT_REQUEST,
    STREAM_INIT_REPLY:              D.MTI_STREAM_INIT_REPLY,
    STREAM_COMPLETE:                D.MTI_STREAM_COMPLETE,
    STREAM_PROCEED:                 D.MTI_STREAM_PROCEED,
    STREAM_SEND:                    D.MTI_STREAM_SEND,
    DATAGRAM:                       D.MTI_DATAGRAM,
    DATAGRAM_OK_REPLY:              D.MTI_DATAGRAM_OK_REPLY,
    DATAGRAM_REJECTED_REPLY:        D.MTI_DATAGRAM_REJECTED_REPLY,

    // Train control
    TRAIN_PROTOCOL:                 D.MTI_TRAIN_PROTOCOL,
    TRAIN_REPLY:                    D.MTI_TRAIN_REPLY,
});

// ---------------------------------------------------------------------------
// AddressSpace — OpenLCB well-known memory-config address space IDs.
// ---------------------------------------------------------------------------
export const AddressSpace = Object.freeze({
    CONFIGURATION_DEFINITION_INFO:     D.CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO, // 0xFF
    ALL:                               D.CONFIG_MEM_SPACE_ALL,                            // 0xFE
    CONFIGURATION_MEMORY:              D.CONFIG_MEM_SPACE_CONFIGURATION_MEMORY,           // 0xFD
    ACDI_MANUFACTURER_ACCESS:          D.CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS,       // 0xFC
    ACDI_USER_ACCESS:                  D.CONFIG_MEM_SPACE_ACDI_USER_ACCESS,               // 0xFB
    TRAIN_FUNCTION_DEFINITION_INFO:    D.CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO, // 0xFA
    TRAIN_FUNCTION_CONFIGURATION_MEMORY: D.CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY, // 0xF9
    FIRMWARE:                          D.CONFIG_MEM_SPACE_FIRMWARE,                       // 0xEF
});

// ---------------------------------------------------------------------------
// TrainSearchFlag — flag bits in a train search event ID.
// ---------------------------------------------------------------------------
export const TrainSearchFlag = Object.freeze({
    ADDRESS_ONLY: D.TRAIN_SEARCH_FLAG_ADDRESS_ONLY,
    ALLOCATE:     D.TRAIN_SEARCH_FLAG_ALLOCATE,
    EXACT:        D.TRAIN_SEARCH_FLAG_EXACT,
    LONG_ADDR:    D.TRAIN_SEARCH_FLAG_LONG_ADDR,
});

export const TrainSearchSpeedSteps = Object.freeze({
    DEFAULT: D.TRAIN_SEARCH_DCC_SPEED_STEPS_DEFAULT, // 0
    STEPS_14: D.TRAIN_SEARCH_DCC_SPEED_STEPS_14,     // 1
    STEPS_28: D.TRAIN_SEARCH_DCC_SPEED_STEPS_28,     // 2
    STEPS_128: D.TRAIN_SEARCH_DCC_SPEED_STEPS_128,   // 3
});

export const TrainSearchProtocol = Object.freeze({
    ANY:                D.TRAIN_SEARCH_PROTOCOL_ANY,
    OPENLCB_NATIVE:     D.TRAIN_SEARCH_PROTOCOL_OPENLCB_NATIVE,
    MFX:                D.TRAIN_SEARCH_PROTOCOL_MFX,
    MM_ANY:             D.TRAIN_SEARCH_PROTOCOL_MM_ANY,
    MM_V1:              D.TRAIN_SEARCH_PROTOCOL_MM_V1,
    MM_V2:              D.TRAIN_SEARCH_PROTOCOL_MM_V2,
    MM_V2_EXTENDED:     D.TRAIN_SEARCH_PROTOCOL_MM_V2_EXTENDED,
    FAMILY_NATIVE:      D.TRAIN_SEARCH_PROTOCOL_FAMILY_NATIVE,
    FAMILY_DCC:         D.TRAIN_SEARCH_PROTOCOL_FAMILY_DCC,
});

// ---------------------------------------------------------------------------
// Broadcast Time — well-known clock IDs + command-byte values.
// ---------------------------------------------------------------------------
export const BroadcastTimeClock = Object.freeze({
    DEFAULT_FAST:      D.BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK,
    DEFAULT_REALTIME:  D.BROADCAST_TIME_ID_DEFAULT_REALTIME_CLOCK,
    ALTERNATE_1:       D.BROADCAST_TIME_ID_ALTERNATE_CLOCK_1,
    ALTERNATE_2:       D.BROADCAST_TIME_ID_ALTERNATE_CLOCK_2,
});

export const BroadcastTimeCommand = Object.freeze({
    QUERY:          D.BROADCAST_TIME_QUERY,
    STOP:           D.BROADCAST_TIME_STOP,
    START:          D.BROADCAST_TIME_START,
    DATE_ROLLOVER:  D.BROADCAST_TIME_DATE_ROLLOVER,
});

// ---------------------------------------------------------------------------
// Well-known event IDs (global emergencies, node state, DCC, etc.).
// ---------------------------------------------------------------------------
export const Event = Object.freeze({
    EMERGENCY_STOP:         D.EVENT_ID_EMERGENCY_STOP,
    EMERGENCY_OFF:          D.EVENT_ID_EMERGENCY_OFF,
    CLEAR_EMERGENCY_STOP:   D.EVENT_ID_CLEAR_EMERGENCY_STOP,
    CLEAR_EMERGENCY_OFF:    D.EVENT_ID_CLEAR_EMERGENCY_OFF,
    IS_TRAIN:               D.EVENT_ID_TRAIN,
    IS_TRAIN_PROXY:         D.EVENT_ID_TRAIN_PROXY,
    DUPLICATE_NODE_DETECTED: D.EVENT_ID_DUPLICATE_NODE_DETECTED,
    FIRMWARE_CORRUPTED:     D.EVENT_ID_FIRMWARE_CORRUPTED,
    FIRMWARE_UPGRADE_BY_HW_SWITCH: D.EVENT_ID_FIRMWARE_UPGRADE_BY_HARDWARE_SWITCH,
    NODE_RECORDED_NEW_LOG:  D.EVENT_ID_NODE_RECORDED_NEW_LOG,
    POWER_BROWN_OUT_NODE:   D.EVENT_ID_POWER_SUPPLY_BROWN_OUT_NODE,
    POWER_BROWN_OUT_STANDARD: D.EVENT_ID_POWER_SUPPLY_BROWN_OUT_STANDARD,
    IDENT_BUTTON_COMBO_PRESSED: D.EVENT_ID_IDENT_BUTTON_COMBO_PRESSED,
});

// ---------------------------------------------------------------------------
// Library version metadata (from OpenLcbCLib).
// ---------------------------------------------------------------------------
export const Version = Object.freeze({
    C_LIB:        D.OPENLCB_C_LIB_VERSION,
    C_LIB_MAJOR:  D.OPENLCB_C_LIB_VERSION_MAJOR,
    C_LIB_MINOR:  D.OPENLCB_C_LIB_VERSION_MINOR,
    C_LIB_PATCH:  D.OPENLCB_C_LIB_VERSION_PATCH,
});

// ---------------------------------------------------------------------------
// Enum types — names lifted directly from C enum bodies.  The codegen now
// emits both flat constants (`EVENT_STATUS_SET = 1`) and grouped objects
// (`event_status_enum.EVENT_STATUS_SET`).  Re-grouped here under PascalCase
// names matching the rest of this file's style.
// ---------------------------------------------------------------------------

export const EventStatus           = D.event_status_enum;
export const EventRangeCount       = D.event_range_count_enum;
export const TrainEmergencyType    = D.train_emergency_type_enum;
export const BroadcastTimeEventType = D.broadcast_time_event_type_enum;
export const DccDetectorDirection  = D.dcc_detector_direction_enum;
export const DccDetectorAddressType = D.dcc_detector_address_type_enum;
export const StreamState           = D.stream_state_enum;
export const ConfigMemStreamPhase  = D.config_mem_stream_phase_enum;
export const SpaceEncoding         = D.space_encoding_enum;
export const PayloadType           = D.payload_type_enum;

// Ported from OpenLcbCLib/src/openlcb/openlcb_defines.h
//
// All numeric constants for the OpenLCB library in one place: login states,
// CAN frame fields, MTIs, error codes, Config Mem commands, Broadcast Time
// event IDs, Train Control instruction bytes, and well-known events.
//
// Numeric types:
//   - Small (fits in 32 bits): regular Number.
//   - 48/64-bit values (Event IDs, Node IDs, large masks): BigInt (n-suffixed).

// ---------------------------------------------------------------------------
// Library version
// ---------------------------------------------------------------------------

export const OPENLCB_JS_LIB_VERSION_MAJOR = 1;
export const OPENLCB_JS_LIB_VERSION_MINOR = 1;
export const OPENLCB_JS_LIB_VERSION_PATCH = 0;
export const OPENLCB_JS_LIB_VERSION = '1.1.0';

// ---------------------------------------------------------------------------
// Node login state machine states (CAN alias allocation)
// ---------------------------------------------------------------------------

export const RUNSTATE_INIT = 0;
export const RUNSTATE_GENERATE_SEED = 1;
export const RUNSTATE_GENERATE_ALIAS = 2;
export const RUNSTATE_LOAD_CHECK_ID_07 = 3;
export const RUNSTATE_LOAD_CHECK_ID_06 = 4;
export const RUNSTATE_LOAD_CHECK_ID_05 = 5;
export const RUNSTATE_LOAD_CHECK_ID_04 = 6;
export const RUNSTATE_WAIT_200ms = 7;
export const RUNSTATE_LOAD_RESERVE_ID = 8;
export const RUNSTATE_LOAD_ALIAS_MAP_DEFINITION = 9;
export const RUNSTATE_LOAD_INITIALIZATION_COMPLETE = 10;
export const RUNSTATE_LOAD_CONSUMER_EVENTS = 11;
export const RUNSTATE_LOAD_PRODUCER_EVENTS = 12;
export const RUNSTATE_LOGIN_COMPLETE = 13;
export const RUNSTATE_RUN = 14;

// ---------------------------------------------------------------------------
// CAN 29-bit identifier bit definitions and frame type codes
// ---------------------------------------------------------------------------

export const RESERVED_TOP_BIT = 0x10000000;
export const CAN_OPENLCB_MSG = 0x08000000;
export const MASK_CAN_FRAME_SEQUENCE_NUMBER = 0x07000000;
export const MASK_CAN_FRAME_TYPE = MASK_CAN_FRAME_SEQUENCE_NUMBER;
export const MASK_CAN_VARIABLE_FIELD = 0x00FFF000;
export const OPENLCB_MESSAGE_STANDARD_FRAME_TYPE = 0x01000000;
export const CAN_FRAME_TYPE_DATAGRAM_ONLY = 0x02000000;
export const CAN_FRAME_TYPE_DATAGRAM_FIRST = 0x03000000;
export const CAN_FRAME_TYPE_DATAGRAM_MIDDLE = 0x04000000;
export const CAN_FRAME_TYPE_DATAGRAM_FINAL = 0x05000000;
export const CAN_FRAME_TYPE_RESERVED = 0x06000000;
export const CAN_FRAME_TYPE_STREAM = 0x07000000;

// ---------------------------------------------------------------------------
// MTI - Message Network (node identification, verify, protocol support)
// ---------------------------------------------------------------------------

export const MTI_INITIALIZATION_COMPLETE = 0x0100;
export const MTI_INITIALIZATION_COMPLETE_SIMPLE = 0x0101;
export const MTI_VERIFY_NODE_ID_ADDRESSED = 0x0488;
export const MTI_VERIFY_NODE_ID_GLOBAL = 0x0490;
export const MTI_VERIFIED_NODE_ID = 0x0170;
export const MTI_VERIFIED_NODE_ID_SIMPLE = 0x0171;
export const MTI_OPTIONAL_INTERACTION_REJECTED = 0x0068;
export const MTI_TERMINATE_DUE_TO_ERROR = 0x00A8;
export const MTI_PROTOCOL_SUPPORT_INQUIRY = 0x0828;
export const MTI_PROTOCOL_SUPPORT_REPLY = 0x0668;

// ---------------------------------------------------------------------------
// MTI - Event transport (Producer/Consumer/PCER)
// ---------------------------------------------------------------------------

export const MTI_CONSUMER_IDENTIFY = 0x08F4;
export const MTI_CONSUMER_RANGE_IDENTIFIED = 0x04A4;
export const MTI_CONSUMER_IDENTIFIED_UNKNOWN = 0x04C7;
export const MTI_CONSUMER_IDENTIFIED_SET = 0x04C4;
export const MTI_CONSUMER_IDENTIFIED_CLEAR = 0x04C5;
export const MTI_CONSUMER_IDENTIFIED_RESERVED = 0x04C6;
export const MTI_PRODUCER_IDENTIFY = 0x0914;
export const MTI_PRODUCER_RANGE_IDENTIFIED = 0x0524;
export const MTI_PRODUCER_IDENTIFIED_UNKNOWN = 0x0547;
export const MTI_PRODUCER_IDENTIFIED_SET = 0x0544;
export const MTI_PRODUCER_IDENTIFIED_CLEAR = 0x0545;
export const MTI_PRODUCER_IDENTIFIED_RESERVED = 0x0546;
export const MTI_EVENTS_IDENTIFY_DEST = 0x0968;
export const MTI_EVENTS_IDENTIFY = 0x0970;
export const MTI_EVENT_LEARN = 0x0594;
export const MTI_PC_EVENT_REPORT = 0x05B4;
export const MTI_PC_EVENT_REPORT_WITH_PAYLOAD = 0x0F14;

// ---------------------------------------------------------------------------
// MTI - SNIP
// ---------------------------------------------------------------------------

export const MTI_SIMPLE_NODE_INFO_REQUEST = 0x0DE8;
export const MTI_SIMPLE_NODE_INFO_REPLY = 0x0A08;

// ---------------------------------------------------------------------------
// MTI - Train protocol
// ---------------------------------------------------------------------------

export const MTI_TRAIN_PROTOCOL = 0x05EB;
export const MTI_TRAIN_REPLY = 0x01E9;
export const MTI_SIMPLE_TRAIN_INFO_REQUEST = 0x0DA8;
export const MTI_SIMPLE_TRAIN_INFO_REPLY = 0x09C8;

// ---------------------------------------------------------------------------
// MTI - Stream protocol
// ---------------------------------------------------------------------------

export const MTI_STREAM_INIT_REQUEST = 0x0CC8;
export const MTI_STREAM_INIT_REPLY = 0x0868;
export const MTI_FRAME_TYPE_CAN_STREAM_SEND = 0xF000;
export const MTI_STREAM_SEND = 0x1F88;
export const MTI_STREAM_PROCEED = 0x0888;
export const MTI_STREAM_COMPLETE = 0x08A8;
export const STREAM_REPLY_ACCEPT = 0x8000;
export const STREAM_ID_RESERVED = 0xFF;

// ---------------------------------------------------------------------------
// MTI - Datagram protocol
// ---------------------------------------------------------------------------

export const MTI_DATAGRAM = 0x1C48;
export const MTI_DATAGRAM_OK_REPLY = 0x0A28;
export const MTI_DATAGRAM_REJECTED_REPLY = 0x0A48;

// ---------------------------------------------------------------------------
// Multi-frame indicator bits in the first data byte (bits 5-4)
// ---------------------------------------------------------------------------

export const MASK_MULTIFRAME_BITS = 0x30;
export const MULTIFRAME_ONLY = 0x00;
export const MULTIFRAME_FIRST = 0x10;
export const MULTIFRAME_MIDDLE = 0x30;
export const MULTIFRAME_FINAL = 0x20;

// ---------------------------------------------------------------------------
// MTI bit field masks
// ---------------------------------------------------------------------------

export const MASK_STREAM_OR_DATAGRAM = 0x01000;
export const MASK_PRIORITY = 0x00C00;
export const MASK_SIMPLE_PROTOCOL = 0x00010;
export const MASK_DEST_ADDRESS_PRESENT = 0x00008;
export const MASK_EVENT_PRESENT = 0x00004;
export const MASK_PRIORITY_MODIFIER = 0x00003;

// ---------------------------------------------------------------------------
// CAN control frames (CID/RID/AMD/AME/AMR and error info)
// ---------------------------------------------------------------------------

export const CAN_CONTROL_FRAME_CID7 = 0x07000000;
export const CAN_CONTROL_FRAME_CID6 = 0x06000000;
export const CAN_CONTROL_FRAME_CID5 = 0x05000000;
export const CAN_CONTROL_FRAME_CID4 = 0x04000000;
export const CAN_CONTROL_FRAME_CID3 = 0x03000000;
export const CAN_CONTROL_FRAME_CID2 = 0x02000000;
export const CAN_CONTROL_FRAME_CID1 = 0x01000000;
export const CAN_CONTROL_FRAME_RID = 0x00700000;
export const CAN_CONTROL_FRAME_AMD = 0x00701000;
export const CAN_CONTROL_FRAME_AME = 0x00702000;
export const CAN_CONTROL_FRAME_AMR = 0x00703000;
export const CAN_CONTROL_FRAME_ERROR_INFO_REPORT_0 = 0x00710000;
export const CAN_CONTROL_FRAME_ERROR_INFO_REPORT_1 = 0x00711000;
export const CAN_CONTROL_FRAME_ERROR_INFO_REPORT_2 = 0x00712000;
export const CAN_CONTROL_FRAME_ERROR_INFO_REPORT_3 = 0x00713000;

// ---------------------------------------------------------------------------
// CAN identifier field masks
// ---------------------------------------------------------------------------

export const MASK_CAN_STREAM_OR_DATAGRAM = 0x01000000;
export const MASK_CAN_PRIORITY = 0x00C00000;
export const MASK_CAN_SIMPLE_PROTOCOL = 0x00010000;
export const MASK_CAN_DEST_ADDRESS_PRESENT = 0x00008000;
export const MASK_CAN_EVENT_PRESENT = 0x00004000;
export const MASK_CAN_PRIORITY_MODIFIER = 0x00003000;
export const MASK_CAN_SOURCE_ALIAS = 0x00000FFF;

// ---------------------------------------------------------------------------
// Protocol Support Indicator bits (48-bit field, but top 24 bits only used)
// ---------------------------------------------------------------------------

export const PSI_SIMPLE = 0x800000;
export const PSI_DATAGRAM = 0x400000;
export const PSI_STREAM = 0x200000;
export const PSI_MEMORY_CONFIGURATION = 0x100000;
export const PSI_RESERVATION = 0x080000;
export const PSI_EVENT_EXCHANGE = 0x040000;
export const PSI_IDENTIFICATION = 0x020000;
export const PSI_TEACHING_LEARNING = 0x010000;
export const PSI_REMOTE_BUTTON = 0x008000;
export const PSI_ABBREVIATED_DEFAULT_CDI = 0x004000;
export const PSI_DISPLAY = 0x002000;
export const PSI_SIMPLE_NODE_INFORMATION = 0x001000;
export const PSI_CONFIGURATION_DESCRIPTION_INFO = 0x000800;
export const PSI_TRAIN_CONTROL = 0x000400;
export const PSI_FUNCTION_DESCRIPTION = 0x000200;
export const PSI_RESERVED_0 = 0x000100;
export const PSI_RESERVED_1 = 0x000080;
export const PSI_FUNCTION_CONFIGURATION = 0x000040;
export const PSI_FIRMWARE_UPGRADE = 0x000020;
export const PSI_FIRMWARE_UPGRADE_ACTIVE = 0x000010;

// ---------------------------------------------------------------------------
// Well-known Event IDs (64-bit values — BigInt)
// ---------------------------------------------------------------------------

// Auto-routed (0x0100...):
export const EVENT_ID_EMERGENCY_OFF = 0x010000000000FFFFn;
export const EVENT_ID_CLEAR_EMERGENCY_OFF = 0x010000000000FFFEn;
export const EVENT_ID_EMERGENCY_STOP = 0x010000000000FFFDn;
export const EVENT_ID_CLEAR_EMERGENCY_STOP = 0x010000000000FFFCn;
export const EVENT_ID_NODE_RECORDED_NEW_LOG = 0x010000000000FFF8n;
export const EVENT_ID_POWER_SUPPLY_BROWN_OUT_NODE = 0x010000000000FFF1n;
export const EVENT_ID_POWER_SUPPLY_BROWN_OUT_STANDARD = 0x010000000000FFF0n;
export const EVENT_ID_IDENT_BUTTON_COMBO_PRESSED = 0x010000000000FF00n;
export const EVENT_ID_LINK_ERROR_CODE_1 = 0x010000000000FF01n;
export const EVENT_ID_LINK_ERROR_CODE_2 = 0x010000000000FF02n;
export const EVENT_ID_LINK_ERROR_CODE_3 = 0x010000000000FF03n;
export const EVENT_ID_LINK_ERROR_CODE_4 = 0x010000000000FF04n;

// Non-auto-routed (0x0101...):
export const EVENT_ID_DUPLICATE_NODE_DETECTED = 0x0101000000000201n;
export const EVENT_ID_TRAIN = 0x0101000000000303n;
export const EVENT_ID_TRAIN_PROXY = 0x0101000000000304n;
export const EVENT_ID_FIRMWARE_CORRUPTED = 0x0101000000000601n;
export const EVENT_ID_FIRMWARE_UPGRADE_BY_HARDWARE_SWITCH = 0x0101000000000602n;
export const EVENT_ID_CBUS_OFF_SPACE = 0x0101010000000000n;
export const EVENT_ID_CBUS_ON_SPACE = 0x0101010100000000n;
export const EVENT_ID_DCC_ACCESSORY_ACTIVATE = 0x0101020000FF0000n;
export const EVENT_ID_DCC_ACCESSORY_DEACTIVATE = 0x0101020000FE0000n;
export const EVENT_ID_DCC_TURNOUT_FEEDBACK_HIGH = 0x0101020000FD0000n;
export const EVENT_ID_DCC_TURNOUT_FEEDBACK_LOW = 0x0101020000FC0000n;
export const EVENT_ID_DCC_SENSOR_FEEDBACK_HIGH = 0x0101020000FB0000n;
export const EVENT_ID_DCC_SENSOR_FEEDBACK_LO = 0x0101020000FA0000n;
export const EVENT_ID_DCC_EXTENDED_ACCESSORY_CMD_SPACE = 0x01010200010000FFn;
export const EVENT_TRAIN_SEARCH_SPACE = 0x090099FF00000000n;
export const TRAIN_SEARCH_MASK = 0xFFFFFFFF00000000n;

// Train search flag byte values:
export const TRAIN_SEARCH_FLAG_ALLOCATE = 0x80;
export const TRAIN_SEARCH_FLAG_EXACT = 0x40;
export const TRAIN_SEARCH_FLAG_ADDRESS_ONLY = 0x20;
export const TRAIN_SEARCH_FLAG_DCC = 0x08;
export const TRAIN_SEARCH_FLAG_LONG_ADDR = 0x04;
export const TRAIN_SEARCH_SPEED_STEP_MASK = 0x03;
export const TRAIN_MAX_DCC_SHORT_ADDRESS = 128;

// ---------------------------------------------------------------------------
// Error codes (permanent 0x1xxx, temporary 0x2xxx)
// ---------------------------------------------------------------------------

export const S_OK = 0x00;
export const ERROR_PERMANENT = 0x1000;
export const ERROR_PERMANENT_STREAMS_NOT_SUPPORTED = 0x1010;
export const ERROR_PERMANENT_CONFIG_MEM_ADDRESS_SPACE_UNKNOWN = 0x1081;
export const ERROR_PERMANENT_CONFIG_MEM_OUT_OF_BOUNDS_INVALID_ADDRESS = 0x1082;
export const ERROR_PERMANENT_CONFIG_MEM_ADDRESS_WRITE_TO_READ_ONLY = 0x1083;
export const ERROR_PERMANENT_SOURCE_NOT_PERMITTED = 0x1020;
export const ERROR_PERMANENT_NOT_IMPLEMENTED = 0x1040;
export const ERROR_PERMANENT_NOT_IMPLEMENTED_SUBCOMMAND_UNKNOWN = 0x1041;
export const ERROR_PERMANENT_NOT_IMPLEMENTED_COMMAND_UNKNOWN = 0x1042;
export const ERROR_PERMANENT_NOT_IMPLEMENTED_UNKNOWN_MTI_OR_TRANPORT_PROTOCOL = 0x1043;
export const ERROR_CODE_PERMANENT_COUNT_OUT_OF_RANGE = 0x1044;
export const ERROR_PERMANENT_INVALID_ARGUMENTS = 0x1080;
export const ERROR_TEMPORARY = 0x2000;
export const ERROR_TEMPORARY_BUFFER_UNAVAILABLE = 0x2020;
export const ERROR_TEMPORARY_NOT_EXPECTED_OUT_OF_ORDER = 0x2040;
export const ERROR_TEMPORARY_TRANSFER_ERROR = 0x2080;
export const ERROR_TEMPORARY_TIME_OUT = 0x2011;
export const ERROR_TEMPORARY_OUT_OF_ORDER_MIDDLE_END_WITH_NO_START = 0x2041;
export const ERROR_TEMPORARY_OUT_OF_ORDER_START_BEFORE_LAST_END = 0x2042;

// ---------------------------------------------------------------------------
// Datagram flags
// ---------------------------------------------------------------------------

export const DATAGRAM_OK_REPLY_PENDING = 0x80;

// ---------------------------------------------------------------------------
// Configuration Memory Protocol (datagram byte 0)
// ---------------------------------------------------------------------------

export const CONFIG_MEM_CONFIGURATION = 0x20;

// Read commands / replies:
export const CONFIG_MEM_READ_SPACE_IN_BYTE_6 = 0x40;
export const CONFIG_MEM_READ_SPACE_FD = 0x41;
export const CONFIG_MEM_READ_SPACE_FE = 0x42;
export const CONFIG_MEM_READ_SPACE_FF = 0x43;
export const CONFIG_MEM_READ_REPLY_OK_SPACE_IN_BYTE_6 = 0x50;
export const CONFIG_MEM_READ_REPLY_OK_SPACE_FD = 0x51;
export const CONFIG_MEM_READ_REPLY_OK_SPACE_FE = 0x52;
export const CONFIG_MEM_READ_REPLY_OK_SPACE_FF = 0x53;
export const CONFIG_MEM_READ_REPLY_FAIL_SPACE_IN_BYTE_6 = 0x58;
export const CONFIG_MEM_READ_REPLY_FAIL_SPACE_FD = 0x59;
export const CONFIG_MEM_READ_REPLY_FAIL_SPACE_FE = 0x5A;
export const CONFIG_MEM_READ_REPLY_FAIL_SPACE_FF = 0x5B;

// Read stream commands / replies:
export const CONFIG_MEM_READ_STREAM_SPACE_IN_BYTE_6 = 0x60;
export const CONFIG_MEM_READ_STREAM_SPACE_FD = 0x61;
export const CONFIG_MEM_READ_STREAM_SPACE_FE = 0x62;
export const CONFIG_MEM_READ_STREAM_SPACE_FF = 0x63;
export const CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_IN_BYTE_6 = 0x70;
export const CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FD = 0x71;
export const CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FE = 0x72;
export const CONFIG_MEM_READ_STREAM_REPLY_OK_SPACE_FF = 0x73;
export const CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_IN_BYTE_6 = 0x78;
export const CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FD = 0x79;
export const CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FE = 0x7A;
export const CONFIG_MEM_READ_STREAM_REPLY_FAIL_SPACE_FF = 0x7B;

// Write commands / replies:
export const CONFIG_MEM_WRITE_SPACE_IN_BYTE_6 = 0x00;
export const CONFIG_MEM_WRITE_SPACE_FD = 0x01;
export const CONFIG_MEM_WRITE_SPACE_FE = 0x02;
export const CONFIG_MEM_WRITE_SPACE_FF = 0x03;
export const CONFIG_MEM_WRITE_REPLY_OK_SPACE_IN_BYTE_6 = 0x10;
export const CONFIG_MEM_WRITE_REPLY_OK_SPACE_FD = 0x11;
export const CONFIG_MEM_WRITE_REPLY_OK_SPACE_FE = 0x12;
export const CONFIG_MEM_WRITE_REPLY_OK_SPACE_FF = 0x13;
export const CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_IN_BYTE_6 = 0x18;
export const CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FD = 0x19;
export const CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FE = 0x1A;
export const CONFIG_MEM_WRITE_REPLY_FAIL_SPACE_FF = 0x1B;

// Write-under-mask commands:
export const CONFIG_MEM_WRITE_UNDER_MASK_SPACE_IN_BYTE_6 = 0x08;
export const CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FD = 0x09;
export const CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FE = 0x0A;
export const CONFIG_MEM_WRITE_UNDER_MASK_SPACE_FF = 0x0B;

// Write stream commands / replies:
export const CONFIG_MEM_WRITE_STREAM_SPACE_IN_BYTE_6 = 0x20;
export const CONFIG_MEM_WRITE_STREAM_SPACE_FD = 0x21;
export const CONFIG_MEM_WRITE_STREAM_SPACE_FE = 0x22;
export const CONFIG_MEM_WRITE_STREAM_SPACE_FF = 0x23;
export const CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_IN_BYTE_6 = 0x30;
export const CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FD = 0x31;
export const CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FE = 0x32;
export const CONFIG_MEM_WRITE_STREAM_REPLY_OK_SPACE_FF = 0x33;
export const CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_IN_BYTE_6 = 0x38;
export const CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FD = 0x39;
export const CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FE = 0x3A;
export const CONFIG_MEM_WRITE_STREAM_REPLY_FAIL_SPACE_FF = 0x3B;

// Operations:
export const CONFIG_MEM_OPTIONS_CMD = 0x80;
export const CONFIG_MEM_OPTIONS_REPLY = 0x82;
export const CONFIG_MEM_GET_ADDRESS_SPACE_INFO_CMD = 0x84;
export const CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_NOT_PRESENT = 0x86;
export const CONFIG_MEM_GET_ADDRESS_SPACE_INFO_REPLY_PRESENT = 0x87;
export const CONFIG_MEM_RESERVE_LOCK = 0x88;
export const CONFIG_MEM_RESERVE_LOCK_REPLY = 0x8A;
export const CONFIG_MEM_GET_UNIQUE_ID = 0x8C;
export const CONFIG_MEM_GET_UNIQUE_ID_REPLY = 0x8D;
export const CONFIG_MEM_UNFREEZE = 0xA0;
export const CONFIG_MEM_FREEZE = 0xA1;
export const CONFIG_MEM_UPDATE_COMPLETE = 0xA8;
export const CONFIG_MEM_RESET_REBOOT = 0xA9;
export const CONFIG_MEM_FACTORY_RESET = 0xAA;

// Well-known address spaces:
export const CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO = 0xFF;
export const CONFIG_MEM_SPACE_ALL = 0xFE;
export const CONFIG_MEM_SPACE_CONFIGURATION_MEMORY = 0xFD;
export const CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS = 0xFC;
export const CONFIG_MEM_SPACE_ACDI_USER_ACCESS = 0xFB;
export const CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO = 0xFA;
export const CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY = 0xF9;
export const CONFIG_MEM_SPACE_FIRMWARE = 0xEF;

// ACDI manufacturer space (0xFC) layout:
export const CONFIG_MEM_ACDI_MANUFACTURER_VERSION_ADDRESS = 0x00;
export const CONFIG_MEM_ACDI_MANUFACTURER_ADDRESS = 0x01;
export const CONFIG_MEM_ACDI_MODEL_ADDRESS = 0x2A;
export const CONFIG_MEM_ACDI_HARDWARE_VERSION_ADDRESS = 0x53;
export const CONFIG_MEM_ACDI_SOFTWARE_VERSION_ADDRESS = 0x68;
export const CONFIG_MEM_ACDI_VERSION_LEN = 1;
export const CONFIG_MEM_ACDI_MANUFACTURER_LEN = 41;
export const CONFIG_MEM_ACDI_MODEL_LEN = 41;
export const CONFIG_MEM_ACDI_HARDWARE_VERSION_LEN = 21;
export const CONFIG_MEM_ACDI_SOFTWARE_VERSION_LEN = 21;

// ACDI user space (0xFB) layout:
export const CONFIG_MEM_USER_MODEL_ADDRESS = 0x00;
export const CONFIG_MEM_USER_DESCRIPTION_ADDRESS = 0x3F;
export const CONFIG_MEM_ACDI_USER_VERSION_ADDRESS = 0x00;
export const CONFIG_MEM_ACDI_USER_NAME_ADDRESS = 0x01;
export const CONFIG_MEM_ACDI_USER_DESCRIPTION_ADDRESS = 0x40;
export const CONFIG_MEM_ACDI_USER_VERSION_LEN = 1;
export const CONFIG_MEM_ACDI_USER_NAME_LEN = 63;
export const CONFIG_MEM_ACDI_USER_DESCRIPTION_LEN = 64;
export const CONFIG_MEM_CONFIG_USER_NAME_OFFSET = 0x00000000;
export const CONFIG_MEM_CONFIG_USER_DESCRIPTION_OFFSET = 63;

// Config Mem reply offsets:
export const CONFIG_MEM_REPLY_OK_OFFSET = 0x10;
export const CONFIG_MEM_REPLY_FAIL_OFFSET = 0x18;

// Get Configuration Options bit flags:
export const CONFIG_OPTIONS_COMMANDS_WRITE_UNDER_MASK = 0x8000;
export const CONFIG_OPTIONS_COMMANDS_UNALIGNED_READS = 0x4000;
export const CONFIG_OPTIONS_COMMANDS_UNALIGNED_WRITES = 0x2000;
export const CONFIG_OPTIONS_COMMANDS_ACDI_MANUFACTURER_READ = 0x0800;
export const CONFIG_OPTIONS_COMMANDS_ACDI_USER_READ = 0x0400;
export const CONFIG_OPTIONS_COMMANDS_ACDI_USER_WRITE = 0x0200;

export const CONFIG_OPTIONS_WRITE_LENGTH_RESERVED = (0x80 | 0x40 | 0x20 | 0x02);
export const CONFIG_OPTIONS_WRITE_LENGTH_STREAM_READ_WRITE = 0x01;

// Address space info flags:
export const CONFIG_OPTIONS_SPACE_INFO_FLAG_READ_ONLY = 0x01;
export const CONFIG_OPTIONS_SPACE_INFO_FLAG_USE_LOW_ADDRESS = 0x02;

// ---------------------------------------------------------------------------
// Node enumeration keys
// ---------------------------------------------------------------------------

export const MAX_INTERNAL_ENUM_KEYS_VALUES = 6;
export const MAX_USER_ENUM_KEYS_VALUES = 4;
export const USER_ENUM_KEYS_VALUES_1 = 0;
export const USER_ENUM_KEYS_VALUES_2 = 1;
export const USER_ENUM_KEYS_VALUES_3 = 2;
export const USER_ENUM_KEYS_VALUES_4 = 3;
export const MAX_NODE_ENUM_KEY_VALUES = MAX_USER_ENUM_KEYS_VALUES + MAX_INTERNAL_ENUM_KEYS_VALUES;
export const OPENLCB_MAIN_STATMACHINE_NODE_ENUMERATOR_INDEX = MAX_USER_ENUM_KEYS_VALUES;
export const OPENLCB_LOGIN_STATMACHINE_NODE_ENUMERATOR_INDEX = MAX_USER_ENUM_KEYS_VALUES + 1;
export const CAN_STATEMACHINE_NODE_ENUMRATOR_KEY = MAX_USER_ENUM_KEYS_VALUES + 2;
export const DATAGRAM_TIMEOUT_ENUM_KEY = MAX_USER_ENUM_KEYS_VALUES + 3;
export const OPENLCB_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX = MAX_USER_ENUM_KEYS_VALUES + 4;
export const OPENLCB_LOGIN_SIBLING_DISPATCH_NODE_ENUMERATOR_INDEX = MAX_USER_ENUM_KEYS_VALUES + 5;

// ---------------------------------------------------------------------------
// Broadcast Time Protocol Event IDs (64-bit — BigInt)
// ---------------------------------------------------------------------------

export const BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK = 0x0101000001000000n;
export const BROADCAST_TIME_ID_DEFAULT_REALTIME_CLOCK = 0x0101000001010000n;
export const BROADCAST_TIME_ID_ALTERNATE_CLOCK_1 = 0x0101000001020000n;
export const BROADCAST_TIME_ID_ALTERNATE_CLOCK_2 = 0x0101000001030000n;
export const BROADCAST_TIME_MASK_CLOCK_ID = 0xFFFFFFFFFFFF0000n;
export const BROADCAST_TIME_MASK_COMMAND_DATA = 0x000000000000FFFFn;

// Lower-2-byte bases (Number, fit in 16 bits):
export const BROADCAST_TIME_REPORT_TIME_BASE = 0x0000;
export const BROADCAST_TIME_REPORT_DATE_BASE = 0x2100;
export const BROADCAST_TIME_REPORT_YEAR_BASE = 0x3000;
export const BROADCAST_TIME_REPORT_RATE_BASE = 0x4000;
export const BROADCAST_TIME_SET_TIME_BASE = 0x8000;
export const BROADCAST_TIME_SET_DATE_BASE = 0xA100;
export const BROADCAST_TIME_SET_YEAR_BASE = 0xB000;
export const BROADCAST_TIME_SET_RATE_BASE = 0xC000;
export const BROADCAST_TIME_QUERY = 0xF000;
export const BROADCAST_TIME_STOP = 0xF001;
export const BROADCAST_TIME_START = 0xF002;
export const BROADCAST_TIME_DATE_ROLLOVER = 0xF003;
export const BROADCAST_TIME_SET_COMMAND_OFFSET = 0x8000;

// ---------------------------------------------------------------------------
// Train control protocol instruction bytes
// ---------------------------------------------------------------------------

export const TRAIN_INSTRUCTION_P_BIT = 0x80;

// Instruction byte values (byte 0, bits 6:0):
export const TRAIN_SET_SPEED_DIRECTION = 0x00;
export const TRAIN_SET_FUNCTION = 0x01;
export const TRAIN_EMERGENCY_STOP = 0x02;
export const TRAIN_QUERY_SPEEDS = 0x10;
export const TRAIN_QUERY_FUNCTION = 0x11;
export const TRAIN_CONTROLLER_CONFIG = 0x20;
export const TRAIN_LISTENER_CONFIG = 0x30;
export const TRAIN_MANAGEMENT = 0x40;

// Controller config sub-commands (byte 1 under 0x20):
export const TRAIN_CONTROLLER_ASSIGN = 0x01;
export const TRAIN_CONTROLLER_RELEASE = 0x02;
export const TRAIN_CONTROLLER_QUERY = 0x03;
export const TRAIN_CONTROLLER_CHANGED = 0x04;

// Listener config sub-commands (byte 1 under 0x30):
export const TRAIN_LISTENER_ATTACH = 0x01;
export const TRAIN_LISTENER_DETACH = 0x02;
export const TRAIN_LISTENER_QUERY = 0x03;

// Management sub-commands (byte 1 under 0x40):
export const TRAIN_MGMT_RESERVE = 0x01;
export const TRAIN_MGMT_RELEASE = 0x02;
export const TRAIN_MGMT_NOOP = 0x03;

// Listener flags:
export const TRAIN_LISTENER_FLAG_REVERSE = 0x02;
export const TRAIN_LISTENER_FLAG_LINK_F0 = 0x04;
export const TRAIN_LISTENER_FLAG_LINK_FN = 0x08;
export const TRAIN_LISTENER_FLAG_HIDE = 0x80;

// ---------------------------------------------------------------------------
// Null / unassigned identifiers
// ---------------------------------------------------------------------------

export const NULL_NODE_ID = 0x000000000000n;
export const NULL_EVENT_ID = 0x0000000000000000n;

// ---------------------------------------------------------------------------
// Message payload sizes (fixed, no conditional compilation — stream always on)
// ---------------------------------------------------------------------------

export const LEN_MESSAGE_BYTES_BASIC = 16;
export const LEN_MESSAGE_BYTES_DATAGRAM = 72;
export const LEN_MESSAGE_BYTES_SNIP = 256;
export const LEN_MESSAGE_BYTES_STREAM = 256;                // USER_DEFINED_STREAM_BUFFER_LEN default
export const LEN_MESSAGE_BYTES_WORKER =                     // max(SNIP, STREAM)
    LEN_MESSAGE_BYTES_STREAM < LEN_MESSAGE_BYTES_SNIP
        ? LEN_MESSAGE_BYTES_SNIP
        : LEN_MESSAGE_BYTES_STREAM;

export const LEN_EVENT_ID = 8;
export const LEN_DATAGRAM_MAX_PAYLOAD = 64;
export const LEN_EVENT_PAYLOAD = LEN_MESSAGE_BYTES_SNIP;

// SNIP string field lengths (including null terminator):
export const LEN_SNIP_NAME_BUFFER = 41;
export const LEN_SNIP_MODEL_BUFFER = 41;
export const LEN_SNIP_HARDWARE_VERSION_BUFFER = 21;
export const LEN_SNIP_SOFTWARE_VERSION_BUFFER = 21;
export const LEN_SNIP_USER_NAME_BUFFER = 63;
export const LEN_SNIP_USER_DESCRIPTION_BUFFER = 64;
export const LEN_SNIP_USER_DATA = LEN_SNIP_USER_NAME_BUFFER + LEN_SNIP_USER_DESCRIPTION_BUFFER;
export const LEN_SNIP_VERSION = 1;
export const LEN_SNIP_USER_VERSION = 1;
export const LEN_SNIP_STRUCTURE = 264;

// Config mem description buffer lengths:
export const LEN_CONFIG_MEM_OPTIONS_DESCRIPTION = 64 - 1;
export const LEN_CONFIG_MEM_ADDRESS_SPACE_DESCRIPTION = 60 - 1;

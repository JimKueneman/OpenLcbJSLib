// Public API entry point for OpenLcbJSLib.

// ---- Runtime + Node -------------------------------------------------------
export { OpenLcb } from './openlcb/runtime.js';
export { OpenLcbNode } from './openlcb/node.js';

// ---- Errors ---------------------------------------------------------------
export {
    OpenLcbError,
    InvalidArgumentError,
    PoolFullError,
    UnknownNodeError,
    TransportBusyError,
    NotInitializedError,
    ProtocolNotSupportedError,
    WasmLoadError,
    TransportConnectError,
} from './openlcb/errors.js';

// ---- Constants / enums ----------------------------------------------------
export {
    PSI,
    MTI,
    AddressSpace,
    TrainSearchFlag,
    TrainSearchSpeedSteps,
    TrainSearchProtocol,
    BroadcastTimeClock,
    BroadcastTimeCommand,
    Event,
    Version,
    // Enum types (from typedef enum, surfaced by codegen).
    EventStatus,
    EventRangeCount,
    TrainEmergencyType,
    BroadcastTimeEventType,
    DccDetectorDirection,
    DccDetectorAddressType,
    StreamState,
    ConfigMemStreamPhase,
    SpaceEncoding,
    PayloadType,
} from './openlcb/constants.js';

// ---- Transports -----------------------------------------------------------
export { WebSocketTransport, WS_STATE } from './drivers/websocket/transport.js';

// ---- Config memory persistence (optional) ---------------------------------
// Browser — localStorage-backed.  Node users: import FileConfigMemory
// directly from ./storage/file-config-memory.js (Node-only, depends on fs).
export { LocalStorageConfigMemory } from './storage/localstorage-config-memory.js';

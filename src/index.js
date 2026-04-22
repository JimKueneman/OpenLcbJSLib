// Public API entry point for the OpenLcbJSLib browser library.
//
// Applications should generally import `OpenLcbConfig` here — it's the
// high-level factory that wires every subsystem together. The individual
// subsystem exports are available too for advanced / partial-integration
// use cases (e.g. wiring a custom transport instead of WebSocket).

// ---- High-level factory + transport ----
export { OpenLcbConfig } from './openlcb/config.js';
export { WebSocketTransport, WS_STATE } from './drivers/websocket/transport.js';

// ---- Foundation ----
export * as defines from './openlcb/defines.js';
export * as utilities from './openlcb/utilities.js';
export {
    PAYLOAD_TYPE,
    PAYLOAD_TYPE_LEN,
    EVENT_STATUS,
    EVENT_RANGE_COUNT,
    ADDRESS_SPACE_ENCODING,
    BROADCAST_TIME_EVENT_TYPE,
    TRAIN_EMERGENCY_TYPE,
    createMessage,
    createEvent,
    createEventRange,
    createNode,
} from './openlcb/types.js';
export * as float16 from './openlcb/float16.js';
export { MessageFifo } from './openlcb/message-fifo.js';
export { NodePool } from './openlcb/node.js';

// ---- GridConnect codec ----
export {
    GridConnectParser,
    fromCanMsg as gridconnectFromCanMsg,
    toCanMsg as gridconnectToCanMsg,
} from './openlcb/gridconnect.js';

// ---- CAN layer ----
export { createCanMsg, createAliasMapping, createListenerAliasEntry } from './drivers/can/types.js';
export * as canUtilities from './drivers/can/utilities.js';
export { CanBufferFifo } from './drivers/can/buffer-fifo.js';
export { AliasMappings } from './drivers/can/alias-mappings.js';
export { AliasMappingListener } from './drivers/can/alias-mapping-listener.js';
export { CanRxMessageHandler } from './drivers/can/rx-message-handler.js';
export { CanTxMessageHandler } from './drivers/can/tx-message-handler.js';
export { CanRxStatemachine } from './drivers/can/rx-statemachine.js';
export { CanLoginMessageHandler, generateSeed, generateAlias } from './drivers/can/login-message-handler.js';
export { CanLoginStatemachine } from './drivers/can/login-statemachine.js';
export { CanMainStatemachine } from './drivers/can/main-statemachine.js';

// ---- OpenLCB core ----
export { OpenLcbLoginStatemachine } from './openlcb/login-statemachine.js';
export { OpenLcbMainStatemachine } from './openlcb/main-statemachine.js';

// ---- Protocol handlers ----
export { ProtocolMessageNetwork } from './protocol/message-network.js';
export { ProtocolSnip } from './protocol/snip.js';
export { ProtocolEventTransport } from './protocol/event-transport.js';
export { ProtocolDatagramHandler } from './protocol/datagram-handler.js';
export { ProtocolConfigMemRead } from './protocol/config-mem-read.js';
export { ProtocolConfigMemWrite } from './protocol/config-mem-write.js';
export { ProtocolConfigMemOperations } from './protocol/config-mem-operations.js';
export { ProtocolStreamHandler, STREAM_STATE } from './protocol/stream-handler.js';
export { ProtocolConfigMemStream, CONFIG_MEM_STREAM_PHASE } from './protocol/config-mem-stream.js';
export { ProtocolTrainHandler } from './protocol/train-handler.js';
export {
    ProtocolTrainSearchHandler,
    isSearchEvent,
    extractDigits as trainSearchExtractDigits,
    extractFlags as trainSearchExtractFlags,
    digitsToAddress as trainSearchDigitsToAddress,
    createEventId as trainSearchCreateEventId,
} from './protocol/train-search-handler.js';
export {
    ProtocolBroadcastTimeHandler,
    extractClockId as broadcastTimeExtractClockId,
    getEventType as broadcastTimeGetEventType,
    extractTime as broadcastTimeExtractTime,
    extractDate as broadcastTimeExtractDate,
    extractYear as broadcastTimeExtractYear,
    extractRate as broadcastTimeExtractRate,
    createTimeEventId,
    createDateEventId,
    createYearEventId,
    createRateEventId,
    createCommandEventId,
} from './protocol/broadcast-time-handler.js';

// ---- Application layer ----
export { OpenLcbApplication, REGISTRATION_FULL } from './openlcb/application.js';
export { OpenLcbApplicationTrain } from './openlcb/application-train.js';
export { OpenLcbApplicationBroadcastTime } from './openlcb/application-broadcast-time.js';

// ---- Configuration Memory persistence helpers (optional) ----
//
// Browser: LocalStorageConfigMemory (re-exported here).
// Node:    FileConfigMemory lives in ./storage/file-config-memory.js — NOT
//          re-exported here because it imports node:fs which breaks the
//          browser build. Import it directly in Node:
//              import { FileConfigMemory } from 'openlcb-js-lib/src/storage/file-config-memory.js';
export { LocalStorageConfigMemory } from './storage/localstorage-config-memory.js';

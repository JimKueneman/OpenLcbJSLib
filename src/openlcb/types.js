// Ported from OpenLcbCLib/src/openlcb/openlcb_types.h
//
// C structs become plain JS objects. The C library uses static buffer pools
// (BASIC / DATAGRAM / SNIP / STREAM / WORKER) with pre-sized payload arrays.
// In JS we simply allocate a Uint8Array of the appropriate size per message.
//
// 48-bit Node IDs and 64-bit Event IDs are BigInt (see plan's Key Design
// Decisions). 12-bit aliases and 16-bit MTIs remain plain Numbers.

import {
    LEN_MESSAGE_BYTES_BASIC,
    LEN_MESSAGE_BYTES_DATAGRAM,
    LEN_MESSAGE_BYTES_SNIP,
    LEN_MESSAGE_BYTES_STREAM,
    LEN_MESSAGE_BYTES_WORKER,
    NULL_NODE_ID,
    NULL_EVENT_ID,
} from './defines.js';

// ---------------------------------------------------------------------------
// Payload type — string constants replace C's payload_type_enum.
// ---------------------------------------------------------------------------

export const PAYLOAD_TYPE = Object.freeze({
    BASIC: 'BASIC',
    DATAGRAM: 'DATAGRAM',
    SNIP: 'SNIP',
    STREAM: 'STREAM',
    WORKER: 'WORKER',
});

export const PAYLOAD_TYPE_LEN = Object.freeze({
    BASIC: LEN_MESSAGE_BYTES_BASIC,
    DATAGRAM: LEN_MESSAGE_BYTES_DATAGRAM,
    SNIP: LEN_MESSAGE_BYTES_SNIP,
    STREAM: LEN_MESSAGE_BYTES_STREAM,
    WORKER: LEN_MESSAGE_BYTES_WORKER,
});

// ---------------------------------------------------------------------------
// Event status and range count — enum-style constants.
// ---------------------------------------------------------------------------

export const EVENT_STATUS = Object.freeze({
    UNKNOWN: 0,
    SET: 1,
    CLEAR: 2,
});

export const EVENT_RANGE_COUNT = Object.freeze({
    C_1: 0,
    C_2: 2,
    C_4: 4,
    C_8: 8,
    C_16: 16,
    C_32: 32,
    C_64: 64,
    C_128: 128,
    C_256: 256,
    C_512: 512,
    C_1024: 1024,
    C_2048: 2048,
    C_4096: 4096,
    C_8192: 8192,
    C_16384: 16384,
    C_32768: 32768,
});

// ---------------------------------------------------------------------------
// Address space encoding for config mem commands.
// ---------------------------------------------------------------------------

export const ADDRESS_SPACE_ENCODING = Object.freeze({
    IN_BYTE_1: 0,
    IN_BYTE_6: 1,
});

// ---------------------------------------------------------------------------
// Broadcast time event decoded type.
// ---------------------------------------------------------------------------

export const BROADCAST_TIME_EVENT_TYPE = Object.freeze({
    REPORT_TIME: 0,
    REPORT_DATE: 1,
    REPORT_YEAR: 2,
    REPORT_RATE: 3,
    SET_TIME: 4,
    SET_DATE: 5,
    SET_YEAR: 6,
    SET_RATE: 7,
    QUERY: 8,
    STOP: 9,
    START: 10,
    DATE_ROLLOVER: 11,
    UNKNOWN: 255,
});

// ---------------------------------------------------------------------------
// Train emergency type.
// ---------------------------------------------------------------------------

export const TRAIN_EMERGENCY_TYPE = Object.freeze({
    ESTOP: 0,
    GLOBAL_STOP: 1,
    GLOBAL_OFF: 2,
});

// ---------------------------------------------------------------------------
// Factory: OpenLCB message
// ---------------------------------------------------------------------------

/**
 * Creates an OpenLCB message with a zero-filled payload buffer sized for the
 * given payload type. Defaults match openlcb_msg_t in C.
 *
 * @param {Object} [opts]
 * @param {string} [opts.payloadType=PAYLOAD_TYPE.BASIC]
 * @param {number} [opts.mti=0]
 * @param {number} [opts.sourceAlias=0]
 * @param {bigint} [opts.sourceId=NULL_NODE_ID]
 * @param {number} [opts.destAlias=0]
 * @param {bigint} [opts.destId=NULL_NODE_ID]
 * @returns {Object} openlcb message
 */
export function createMessage({
    payloadType = PAYLOAD_TYPE.BASIC,
    mti = 0,
    sourceAlias = 0,
    sourceId = NULL_NODE_ID,
    destAlias = 0,
    destId = NULL_NODE_ID,
} = {}) {
    const len = PAYLOAD_TYPE_LEN[payloadType];
    if (len === undefined) {
        throw new Error(`createMessage: unknown payloadType "${payloadType}"`);
    }
    return {
        state: {
            allocated: false,
            inprocess: false,
            invalid: false,
            loopback: false,
        },
        mti,
        sourceAlias,
        destAlias,
        sourceId,
        destId,
        payloadType,
        payloadCount: 0,
        payload: new Uint8Array(len),
        timer: { assemblyTicks: 0, tickSnapshot: 0, retryCount: 0 },
        referenceCount: 0,
    };
}

// ---------------------------------------------------------------------------
// Factory: event ID with status
// ---------------------------------------------------------------------------

/**
 * @param {bigint} event 64-bit event id
 * @param {number} [status=EVENT_STATUS.UNKNOWN]
 */
export function createEvent(event = NULL_EVENT_ID, status = EVENT_STATUS.UNKNOWN) {
    return { event, status };
}

// ---------------------------------------------------------------------------
// Factory: event ID range
// ---------------------------------------------------------------------------

/**
 * @param {bigint} startBase starting event ID (bottom 16 bits typically 0)
 * @param {number} [eventCount=EVENT_RANGE_COUNT.C_1]
 */
export function createEventRange(startBase = NULL_EVENT_ID, eventCount = EVENT_RANGE_COUNT.C_1) {
    return { startBase, eventCount };
}

// ---------------------------------------------------------------------------
// Factory: OpenLCB virtual node
// ---------------------------------------------------------------------------

/**
 * Creates a virtual OpenLCB node. Consumer/producer lists start empty; they
 * are populated by the event transport handler during login.
 *
 * @param {bigint} id 48-bit node ID as BigInt
 * @param {Object} [parameters] node parameters (const config)
 */
export function createNode(id = NULL_NODE_ID, parameters = null) {
    return {
        state: {
            runState: 0,
            allocated: false,
            permitted: false,
            initialized: false,
            duplicateIdDetected: false,
            openlcbDatagramAckSent: false,
            resendDatagram: false,
            firmwareUpgradeActive: false,
        },
        id,
        alias: 0,
        seed: id,
        consumers: {
            count: 0,
            list: [],
            rangeCount: 0,
            rangeList: [],
            enumerator: { running: false, enumIndex: 0, rangeEnumIndex: 0 },
        },
        producers: {
            count: 0,
            list: [],
            rangeCount: 0,
            rangeList: [],
            enumerator: { running: false, enumIndex: 0, rangeEnumIndex: 0 },
        },
        parameters,
        timerticks: 0,
        ownerNode: NULL_NODE_ID,
        lastReceivedDatagram: null,
        index: 0,
        trainState: null,
    };
}

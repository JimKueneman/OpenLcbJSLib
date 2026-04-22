// Ported from OpenLcbCLib/src/drivers/canbus/can_types.h
//
// CAN framing constants and a factory for can_msg_t. A CAN frame identifier
// fits in 29 bits, which stays under Number.MAX_SAFE_INTEGER, so we keep
// identifiers as regular Numbers (see plan's Key Design Decisions). The
// payload is a Uint8Array of up to 8 bytes.

// ---------------------------------------------------------------------------
// Frame geometry
// ---------------------------------------------------------------------------

/** Number of data bytes in a CAN 2.0 frame. */
export const LEN_CAN_BYTE_ARRAY = 8;

/** Pass when the CAN payload starts at byte 0 (no destination alias). */
export const OFFSET_CAN_WITHOUT_DEST_ADDRESS = 0;

/** Pass when bytes 0-1 carry a destination alias and data starts at byte 2. */
export const OFFSET_CAN_WITH_DEST_ADDRESS = 2;

// ---------------------------------------------------------------------------
// Segmented PCER-with-payload framing MTIs (CAN layer — openlcb wire MTIs)
// ---------------------------------------------------------------------------

export const CAN_MTI_PCER_WITH_PAYLOAD_FIRST = 0x0F16;
export const CAN_MTI_PCER_WITH_PAYLOAD_MIDDLE = 0x0F15;
export const CAN_MTI_PCER_WITH_PAYLOAD_LAST = 0x0F14;

// ---------------------------------------------------------------------------
// Factory: CAN frame
// ---------------------------------------------------------------------------

/**
 * Allocates a CAN frame object. `identifier` is the raw 29-bit extended CAN
 * identifier; `payload` is an 8-byte Uint8Array; `payloadCount` is the number
 * of valid bytes (0-8).
 *
 * @param {Object} [opts]
 * @param {number} [opts.identifier=0]
 * @param {number} [opts.payloadCount=0]
 * @param {Uint8Array|number[]} [opts.payload] initial payload data
 * @returns {Object} can frame
 */
export function createCanMsg({ identifier = 0, payloadCount = 0, payload = null } = {}) {
    const bytes = new Uint8Array(LEN_CAN_BYTE_ARRAY);
    if (payload) {
        const n = Math.min(payload.length, LEN_CAN_BYTE_ARRAY);
        for (let i = 0; i < n; i++) bytes[i] = payload[i] & 0xFF;
        if (payloadCount === 0) payloadCount = n;
    }
    return {
        state: { allocated: false },
        identifier: identifier >>> 0,
        payloadCount,
        payload: bytes,
    };
}

// ---------------------------------------------------------------------------
// Factory: alias mapping (Node ID ↔ 12-bit alias)
// ---------------------------------------------------------------------------

/**
 * One entry of the alias mapping table. `isDuplicate` is set when another
 * node claims the same alias; `isPermitted` is set once the local node has
 * finished login (AMD transmitted).
 *
 * @param {bigint} [nodeId=0n]
 * @param {number} [alias=0]
 */
export function createAliasMapping(nodeId = 0n, alias = 0) {
    return {
        nodeId,
        alias,
        isDuplicate: false,
        isPermitted: false,
    };
}

// ---------------------------------------------------------------------------
// Factory: listener alias entry (train consist members)
// ---------------------------------------------------------------------------

export function createListenerAliasEntry() {
    return {
        nodeId: 0n,
        alias: 0,
        verifyTicks: 0,
        verifyPending: false,
    };
}

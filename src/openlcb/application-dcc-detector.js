// Ported from OpenLcbCLib/src/openlcb/openlcb_application_dcc_detector.[hc].
//
// Pure encode/decode helpers for DCC Detection Protocol Event IDs.
//
// Each detector Event ID is an 8-byte value laid out as:
//     [ 48-bit detector node ID | 2-bit direction | 14-bit DCC address ]
//
// The 14-bit address field encodes one of four kinds of DCC address,
// distinguished by the upper 6 bits (high byte):
//     0x38 — short address  (low 8 bits = DCC short address 0..127)
//     0x39 — consist address (low 8 bits = DCC consist address 0..127)
//     0x3800 exactly — "track empty" sentinel
//     anything else with high-byte not 0x38/0x39 — long address (14-bit)
//
// Event IDs are JS BigInts (matches defines.js convention).
//
// C-library gating: OPENLCB_COMPILE_DCC_DETECTOR.  The JS port exposes the
// helpers unconditionally — callers gate usage by feature flag at the
// application level.

// =============================================================================
// Direction / occupancy status (upper 2 bits of the 16-bit tail)
// =============================================================================

/** Unoccupied (exit) — decoder has left the monitored section. */
export const DCC_DETECTOR_UNOCCUPIED       = 0x00;

/** Occupied, forward direction (entry). */
export const DCC_DETECTOR_OCCUPIED_FORWARD = 0x01;

/** Occupied, reverse direction (entry). */
export const DCC_DETECTOR_OCCUPIED_REVERSE = 0x02;

/** Occupied, direction unknown (entry). */
export const DCC_DETECTOR_OCCUPIED_UNKNOWN = 0x03;

// =============================================================================
// DCC address type prefixes (upper 6 bits of the 14-bit address field)
// =============================================================================

/** High-byte prefix indicating a DCC short address. */
export const DCC_DETECTOR_SHORT_ADDRESS_PREFIX   = 0x38;

/** High-byte prefix indicating a DCC consist address. */
export const DCC_DETECTOR_CONSIST_ADDRESS_PREFIX = 0x39;

// =============================================================================
// Special sentinel values
// =============================================================================

/** 14-bit value representing "track is empty" (short-address prefix + 0). */
export const DCC_DETECTOR_TRACK_EMPTY = 0x3800;

// =============================================================================
// Bit-field geometry
// =============================================================================

export const DCC_DETECTOR_ADDRESS_BITS    = 14;
export const DCC_DETECTOR_ADDRESS_MASK    = 0x3FFF;
export const DCC_DETECTOR_DIRECTION_MASK  = 0xC000;
export const DCC_DETECTOR_DIRECTION_SHIFT = 14;

// =============================================================================
// Address-type categories (mirrors dcc_detector_address_type_enum)
// =============================================================================

export const DCC_DETECTOR_ADDRESS_LONG        = 'long';
export const DCC_DETECTOR_ADDRESS_SHORT       = 'short';
export const DCC_DETECTOR_ADDRESS_CONSIST     = 'consist';
export const DCC_DETECTOR_ADDRESS_TRACK_EMPTY = 'track_empty';

// =============================================================================
// BigInt constants (precomputed once)
// =============================================================================

const NODE_ID_MASK_48   = 0xFFFFFFFFFFFFn;
const TAIL_MASK_16      = 0xFFFFn;
const ADDR_MASK_14_BIG  = BigInt(DCC_DETECTOR_ADDRESS_MASK);
const DIR_MASK_BIG      = BigInt(DCC_DETECTOR_DIRECTION_MASK);
const DIR_SHIFT_BIG     = BigInt(DCC_DETECTOR_DIRECTION_SHIFT);

// =============================================================================
// Public helpers
// =============================================================================

/**
 * Build a detector Event ID from its parts.
 *
 * @param {bigint} detectorNodeId  48-bit detector node ID
 * @param {number} direction       DCC_DETECTOR_UNOCCUPIED|OCCUPIED_*
 * @param {number} rawAddress14    14-bit DCC address field (already includes
 *                                 type prefix — use makeShortAddress /
 *                                 makeConsistAddress, or pass a raw long addr)
 * @returns {bigint} packed event ID
 */
export function encodeEventId(detectorNodeId, direction, rawAddress14) {
    const nodePart = (BigInt(detectorNodeId) & NODE_ID_MASK_48) << 16n;
    const dirPart  = (BigInt(direction & 0x3) << DIR_SHIFT_BIG);
    const addrPart = BigInt(rawAddress14 & DCC_DETECTOR_ADDRESS_MASK);
    return nodePart | dirPart | addrPart;
}

/**
 * Build the 14-bit raw-address field for a DCC short address (0..127).
 * @param {number} shortAddress
 * @returns {number} 14-bit raw address field
 */
export function makeShortAddress(shortAddress) {
    return ((DCC_DETECTOR_SHORT_ADDRESS_PREFIX << 8) | (shortAddress & 0xFF)) & DCC_DETECTOR_ADDRESS_MASK;
}

/**
 * Build the 14-bit raw-address field for a DCC consist address (0..127).
 * @param {number} consistAddress
 * @returns {number} 14-bit raw address field
 */
export function makeConsistAddress(consistAddress) {
    return ((DCC_DETECTOR_CONSIST_ADDRESS_PREFIX << 8) | (consistAddress & 0xFF)) & DCC_DETECTOR_ADDRESS_MASK;
}

/**
 * Extract the 2-bit direction/occupancy status from a detector Event ID.
 * @param {bigint} eventId
 * @returns {number} 0..3 (DCC_DETECTOR_UNOCCUPIED..OCCUPIED_UNKNOWN)
 */
export function extractDirection(eventId) {
    const tail = BigInt(eventId) & TAIL_MASK_16;
    return Number((tail & DIR_MASK_BIG) >> DIR_SHIFT_BIG);
}

/**
 * Classify the DCC address encoded in a detector Event ID.
 * @param {bigint} eventId
 * @returns {string} one of DCC_DETECTOR_ADDRESS_*
 */
export function extractAddressType(eventId) {
    const raw = Number(BigInt(eventId) & ADDR_MASK_14_BIG);
    if (raw === DCC_DETECTOR_TRACK_EMPTY) return DCC_DETECTOR_ADDRESS_TRACK_EMPTY;
    const highByte = (raw >> 8) & 0x3F;
    if (highByte === DCC_DETECTOR_SHORT_ADDRESS_PREFIX)   return DCC_DETECTOR_ADDRESS_SHORT;
    if (highByte === DCC_DETECTOR_CONSIST_ADDRESS_PREFIX) return DCC_DETECTOR_ADDRESS_CONSIST;
    return DCC_DETECTOR_ADDRESS_LONG;
}

/**
 * Extract the full 14-bit raw DCC address field (including type prefix).
 * @param {bigint} eventId
 * @returns {number}
 */
export function extractRawAddress(eventId) {
    return Number(BigInt(eventId) & ADDR_MASK_14_BIG);
}

/**
 * Extract the usable DCC address:
 *   short/consist → 8-bit address value (prefix stripped)
 *   track_empty   → 0
 *   long          → full 14-bit address
 * @param {bigint} eventId
 * @returns {number}
 */
export function extractDccAddress(eventId) {
    const raw = extractRawAddress(eventId);
    const type = extractAddressType(eventId);
    switch (type) {
        case DCC_DETECTOR_ADDRESS_TRACK_EMPTY: return 0;
        case DCC_DETECTOR_ADDRESS_SHORT:
        case DCC_DETECTOR_ADDRESS_CONSIST:     return raw & 0xFF;
        case DCC_DETECTOR_ADDRESS_LONG:        return raw;
        default:                               return raw;
    }
}

/**
 * Extract the 48-bit detector node ID (upper 6 bytes of the event ID).
 * @param {bigint} eventId
 * @returns {bigint}
 */
export function extractDetectorId(eventId) {
    return (BigInt(eventId) >> 16n) & NODE_ID_MASK_48;
}

/**
 * Test whether the event ID carries the track-empty sentinel
 * (14-bit address field exactly 0x3800, direction bits ignored).
 * @param {bigint} eventId
 * @returns {boolean}
 */
export function isTrackEmpty(eventId) {
    return (BigInt(eventId) & ADDR_MASK_14_BIG) === BigInt(DCC_DETECTOR_TRACK_EMPTY);
}

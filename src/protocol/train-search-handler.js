// Ported from OpenLcbCLib/src/openlcb/protocol_train_search_handler.[hc].
//
// Train Search Protocol — decodes incoming train-search event IDs (upper
// 4 bytes = 0x090099FF) into a search query, matches each train node's DCC
// address and SNIP name, and replies with Producer Identified Set for matches.
// An ALLOCATE flag allows the application to spawn a new virtual train node
// when nothing matches.

import {
    EVENT_TRAIN_SEARCH_SPACE,
    TRAIN_SEARCH_MASK,
    TRAIN_SEARCH_FLAG_ALLOCATE,
    TRAIN_SEARCH_FLAG_EXACT,
    TRAIN_SEARCH_FLAG_ADDRESS_ONLY,
    TRAIN_SEARCH_FLAG_DCC,
    TRAIN_SEARCH_FLAG_LONG_ADDR,
    TRAIN_MAX_DCC_SHORT_ADDRESS,
    MTI_PRODUCER_IDENTIFIED_SET,
} from '../openlcb/defines.js';
import {
    loadOpenlcbMessage,
    copyEventIdToPayload,
} from '../openlcb/utilities.js';

// =============================================================================
// Static utilities — tests can use these without instantiating the class
// =============================================================================

/** True iff the event ID lies in the train search space (upper 4 bytes = 0x090099FF). */
export function isSearchEvent(eventId) {
    return (eventId & TRAIN_SEARCH_MASK) === EVENT_TRAIN_SEARCH_SPACE;
}

/** Extract 6 search nibbles from bits 31..8 of the event ID into `digits[0..5]`. */
export function extractDigits(eventId) {
    const lower = Number(eventId & 0xFFFFFFFFn) >>> 0;
    return [
        (lower >>> 28) & 0x0F,
        (lower >>> 24) & 0x0F,
        (lower >>> 20) & 0x0F,
        (lower >>> 16) & 0x0F,
        (lower >>> 12) & 0x0F,
        (lower >>>  8) & 0x0F,
    ];
}

export function extractFlags(eventId) {
    return Number(eventId & 0xFFn);
}

/** 6-nibble digit array → decimal address (leading 0xF nibbles skipped). */
export function digitsToAddress(digits) {
    let address = 0;
    for (let i = 0; i < 6; i++) {
        if (digits[i] <= 9) address = address * 10 + digits[i];
    }
    return address;
}

/** Encode a decimal DCC address and flags into a train-search event ID. */
export function createEventId(address, flags) {
    const digits = [0x0F, 0x0F, 0x0F, 0x0F, 0x0F, 0x0F];
    if (address === 0) {
        digits[5] = 0;
    } else {
        let i = 5;
        let a = address;
        while (a > 0 && i >= 0) {
            digits[i] = a % 10;
            a = Math.floor(a / 10);
            i--;
        }
    }
    const lower = (
        (digits[0] << 28) | (digits[1] << 24) | (digits[2] << 20) |
        (digits[3] << 16) | (digits[4] << 12) | (digits[5] <<  8) | (flags & 0xFF)
    ) >>> 0;
    return EVENT_TRAIN_SEARCH_SPACE | BigInt(lower);
}

// =============================================================================
// Matchers (private)
// =============================================================================

function hasReservedValues(digits, flags) {
    for (let i = 0; i < 6; i++) {
        if (digits[i] >= 0x0A && digits[i] <= 0x0E) return true;
    }
    if (flags & 0x10) return true;
    if (!(flags & TRAIN_SEARCH_FLAG_DCC) && (flags & 0x07)) return true;
    return false;
}

/** Convert a decimal number into at most 6 decimal-digit nibbles. */
function addressDigits(address) {
    if (address === 0) return [0];
    const rev = [];
    let t = address;
    while (t > 0 && rev.length < 6) {
        rev.push(t % 10);
        t = Math.floor(t / 10);
    }
    return rev.reverse();
}

function searchDigitsNoPadding(digits) {
    const out = [];
    for (const d of digits) {
        if (d <= 9) out.push(d);
    }
    return out;
}

function doesAddressMatch(trainAddress, digits, flags) {
    const trainDigits = addressDigits(trainAddress);
    const searchDigits = searchDigitsNoPadding(digits);
    if (searchDigits.length === 0) return false;

    if (flags & TRAIN_SEARCH_FLAG_EXACT) {
        if (searchDigits.length !== trainDigits.length) return false;
        for (let i = 0; i < searchDigits.length; i++) {
            if (searchDigits[i] !== trainDigits[i]) return false;
        }
        return true;
    }
    // Prefix match.
    if (searchDigits.length > trainDigits.length) return false;
    for (let i = 0; i < searchDigits.length; i++) {
        if (searchDigits[i] !== trainDigits[i]) return false;
    }
    return true;
}

/**
 * Name match per TrainSearchS §6.3: each contiguous digit sequence in the
 * search query (separated by 0xF nibbles) must appear as a digit run in the
 * node's SNIP name.
 */
function doesNameMatch(name, digits, flags) {
    if (!name || name.length === 0) return false;

    let i = 0;
    while (i < 6) {
        if (digits[i] > 9) { i++; continue; }

        const seq = [];
        while (i < 6 && digits[i] <= 9) { seq.push(digits[i]); i++; }

        let seqMatched = false;
        for (let p = 0; p < name.length && !seqMatched; p++) {
            if (name[p] < '0' || name[p] > '9') continue;
            if (p > 0 && name[p - 1] >= '0' && name[p - 1] <= '9') continue;

            let si = 0, np = p;
            while (si < seq.length && np < name.length) {
                if (name[np] < '0' || name[np] > '9') { np++; continue; }
                if ((name.charCodeAt(np) - 48) !== seq[si]) break;
                si++; np++;
            }
            if (si === seq.length) {
                if (flags & TRAIN_SEARCH_FLAG_EXACT) {
                    while (np < name.length && (name[np] < '0' || name[np] > '9')) np++;
                    if (np >= name.length || name[np] < '0' || name[np] > '9') seqMatched = true;
                } else {
                    seqMatched = true;
                }
            }
        }
        if (!seqMatched) return false;
    }
    return true;
}

function doesTrainMatch(trainState, digits, searchAddress, flags, nodeName) {
    // DCC-protocol long/short match.
    if (flags & TRAIN_SEARCH_FLAG_DCC) {
        if (flags & TRAIN_SEARCH_FLAG_LONG_ADDR) {
            if (!trainState.isLongAddress) return false;
        } else if (!(flags & TRAIN_SEARCH_FLAG_ALLOCATE)) {
            if (searchAddress < TRAIN_MAX_DCC_SHORT_ADDRESS && trainState.isLongAddress) return false;
            if (searchAddress >= TRAIN_MAX_DCC_SHORT_ADDRESS && !trainState.isLongAddress) return false;
        }
    }

    if (doesAddressMatch(trainState.dccAddress, digits, flags)) return true;

    if (!(flags & TRAIN_SEARCH_FLAG_ADDRESS_ONLY) && nodeName) {
        if (doesNameMatch(nodeName, digits, flags)) return true;
    }
    return false;
}

// =============================================================================
// Handler class
// =============================================================================

export class ProtocolTrainSearchHandler {
    /**
     * @param {Object} [deps]
     * @param {(node, searchAddress, flags) => void} [deps.onSearchMatched]
     * @param {(searchAddress, flags) => Object|null} [deps.onSearchNoMatch]
     *        Returns a newly-allocated train node to reply on behalf of, or null.
     */
    constructor(deps = {}) {
        this._cb = deps;
    }

    /** Called per train node while enumerating a train-search event. */
    handleSearchEvent(sm, eventId) {
        if (!sm.node || !sm.node.trainState) return;

        const digits = extractDigits(eventId);
        const flags = extractFlags(eventId);
        if (hasReservedValues(digits, flags)) return;

        const searchAddress = digitsToAddress(digits);
        const nodeName = sm.node.parameters?.snip?.name ?? '';
        if (!doesTrainMatch(sm.node.trainState, digits, searchAddress, flags, nodeName)) return;

        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            0, 0n,
            MTI_PRODUCER_IDENTIFIED_SET
        );
        copyEventIdToPayload(sm.outgoing.msg, eventId);
        sm.outgoing.valid = true;

        this._cb.onSearchMatched?.(sm.node, searchAddress, flags);
    }

    /** Called after enumerating all train nodes without a match. */
    handleSearchNoMatch(sm, eventId) {
        if (!sm) return;
        const digits = extractDigits(eventId);
        const flags = extractFlags(eventId);
        if (hasReservedValues(digits, flags)) return;
        if (!(flags & TRAIN_SEARCH_FLAG_ALLOCATE)) return;
        if (!this._cb.onSearchNoMatch) return;

        const searchAddress = digitsToAddress(digits);
        const newNode = this._cb.onSearchNoMatch(searchAddress, flags);
        if (!newNode || !newNode.trainState) return;

        loadOpenlcbMessage(
            sm.outgoing.msg,
            newNode.alias, newNode.id,
            0, 0n,
            MTI_PRODUCER_IDENTIFIED_SET
        );
        copyEventIdToPayload(sm.outgoing.msg, eventId);
        sm.outgoing.valid = true;
    }
}

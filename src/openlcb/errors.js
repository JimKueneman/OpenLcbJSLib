// Typed error classes for OpenLcbJSLib.
//
// WASM exports return negative int32 codes; the JS layer converts those
// into instances of these classes and throws.  Users catch by type:
//
//     try { node.sendPcer(eventId); }
//     catch (e) {
//         if (e instanceof TransportBusyError) { /* retry */ }
//         else { throw e; }
//     }

export class OpenLcbError extends Error {
    constructor(message, { cause } = {}) {
        super(message);
        this.name = this.constructor.name;
        if (cause !== undefined) this.cause = cause;
    }
}

// WASM -1 — argument validation on the C side (unknown space id, bad enum).
export class InvalidArgumentError extends OpenLcbError {}

// WASM -2 — pool full (producer/consumer/range/CAN buffer ceilings).
export class PoolFullError extends OpenLcbError {}

// WASM -3 — no node with the given 48-bit ID.
export class UnknownNodeError extends OpenLcbError {}

// WASM -4 — transport TX path could not accept the frame right now.
// Caller should retry after a delay.
export class TransportBusyError extends OpenLcbError {}

// WASM -5 — wasm_initialize() has not been called.  Should never surface
// in normal use; OpenLcb.create() calls it before returning.
export class NotInitializedError extends OpenLcbError {}

// JS-side — sub-protocol accessed on a node that didn't opt in via
// protocolSupport (e.g. node.train.* when PSI.TRAIN_CONTROL was not set).
export class ProtocolNotSupportedError extends OpenLcbError {}

// JS-side — WASM module failed to load (from OpenLcb.create()).
export class WasmLoadError extends OpenLcbError {}

// JS-side — transport failed to open (from OpenLcb.start() or during reconnect).
export class TransportConnectError extends OpenLcbError {}

// ---------------------------------------------------------------------------
// Internal helper — map a WASM int32 return code to the matching error.
// Returns null if rc is non-negative (success).  Not exported to consumers.
// ---------------------------------------------------------------------------

/**
 * @param {number} rc  the int32 returned by a wasm_* export
 * @param {string} context  short description for the error message
 * @returns {OpenLcbError | null}
 */
export function errorForReturnCode(rc, context) {
    if (rc >= 0) return null;
    switch (rc) {
        case -1: return new InvalidArgumentError(`${context}: invalid argument`);
        case -2: return new PoolFullError(`${context}: pool ceiling exceeded`);
        case -3: return new UnknownNodeError(`${context}: unknown node`);
        case -4: return new TransportBusyError(`${context}: transport TX busy`);
        case -5: return new NotInitializedError(`${context}: wasm_initialize not called`);
        default: return new OpenLcbError(`${context}: unknown WASM error code ${rc}`);
    }
}

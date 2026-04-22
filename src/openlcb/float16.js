// Ported from OpenLcbCLib/src/openlcb/openlcb_float16.[hc]
//
// IEEE 754 half-precision (binary16) conversion utilities for OpenLCB train
// speed. Sign bit encodes direction (0 forward, 1 reverse). The C port uses
// integer-only bit manipulation of the raw float32 pattern; we mirror that
// exactly to preserve bit-for-bit compatibility with the conformance tests.

export const FLOAT16_POSITIVE_ZERO = 0x0000;
export const FLOAT16_NEGATIVE_ZERO = 0x8000;
export const FLOAT16_NAN           = 0x7E00;
export const FLOAT16_SIGN_MASK     = 0x8000;
export const FLOAT16_EXPONENT_MASK = 0x7C00;
export const FLOAT16_MANTISSA_MASK = 0x03FF;

// Shared scratch buffer for float32 ↔ uint32 reinterpretation. Equivalent to
// the C memcpy-based type punning; using a single-element buffer avoids
// allocations on hot paths.
const _scratch = new ArrayBuffer(4);
const _scratchF32 = new Float32Array(_scratch);
const _scratchU32 = new Uint32Array(_scratch);

function floatToBits(f) {
    _scratchF32[0] = f;
    return _scratchU32[0];
}

function bitsToFloat(bits) {
    _scratchU32[0] = bits >>> 0;
    return _scratchF32[0];
}

/**
 * Convert a 32-bit float to a float16 bit pattern. Rounds toward zero,
 * clamps overflow to the max finite half value, and emits FLOAT16_NAN for
 * NaN inputs.
 *
 * @param {number} value
 * @returns {number} 16-bit float16 bit pattern
 */
export function fromFloat(value) {
    const fbits = floatToBits(Math.fround(value));
    const sign = (fbits >>> 16) & 0x8000;
    const exponent = ((fbits >>> 23) & 0xFF) - 127;
    let mantissa = fbits & 0x007FFFFF;

    // Zero (positive or negative).
    if (exponent === -127 && mantissa === 0) {
        return sign;
    }

    // NaN.
    if (exponent === 128 && mantissa !== 0) {
        return (sign | 0x7E00) & 0xFFFF;
    }

    // Infinity.
    if (exponent === 128) {
        return (sign | 0x7C00) & 0xFFFF;
    }

    // Overflow — clamp to max finite half.
    if (exponent > 15) {
        return (sign | 0x7BFF) & 0xFFFF;
    }

    // Normal range for half-precision.
    if (exponent >= -14) {
        const hExp = ((exponent + 15) << 10) & 0xFFFF;
        const hMan = (mantissa >>> 13) & 0xFFFF;
        return (sign | hExp | hMan) & 0xFFFF;
    }

    // Subnormal.
    if (exponent >= -24) {
        mantissa |= 0x00800000;
        const shift = (-14 - exponent);
        const hMan = (mantissa >>> (13 + shift)) & 0xFFFF;
        return (sign | hMan) & 0xFFFF;
    }

    // Too small — flush to signed zero.
    return sign;
}

/**
 * Convert a float16 bit pattern to a 32-bit float.
 *
 * @param {number} half 16-bit bit pattern
 * @returns {number}
 */
export function toFloat(half) {
    const sign = (half & 0x8000) << 16;
    let exponent = (half >>> 10) & 0x1F;
    let mantissa = half & 0x03FF;

    // Zero.
    if (exponent === 0 && mantissa === 0) {
        return bitsToFloat(sign);
    }

    // Subnormal — normalize until leading 1 is in bit 10.
    if (exponent === 0) {
        while ((mantissa & 0x0400) === 0) {
            mantissa <<= 1;
            exponent--;
        }
        exponent++;
        mantissa &= 0x03FF;

        const fExp = ((exponent + 127 - 15) << 23) >>> 0;
        const fMan = mantissa << 13;
        return bitsToFloat((sign | fExp | fMan) >>> 0);
    }

    // Infinity or NaN.
    if (exponent === 0x1F) {
        const fExp = 0xFF << 23;
        const fMan = mantissa << 13;
        return bitsToFloat((sign | fExp | fMan) >>> 0);
    }

    // Normal.
    const fExp = ((exponent + 127 - 15) << 23) >>> 0;
    const fMan = mantissa << 13;
    return bitsToFloat((sign | fExp | fMan) >>> 0);
}

export function negate(half) {
    return (half ^ FLOAT16_SIGN_MASK) & 0xFFFF;
}

export function isNaN16(half) {
    const exp = half & FLOAT16_EXPONENT_MASK;
    const man = half & FLOAT16_MANTISSA_MASK;
    return exp === FLOAT16_EXPONENT_MASK && man !== 0;
}

export function isZero(half) {
    return (half & 0x7FFF) === 0;
}

/**
 * Encode a magnitude + direction into a float16 bit pattern.
 *
 * @param {number} speed magnitude (sign of input is ignored — direction wins)
 * @param {boolean} reverse
 */
export function speedWithDirection(speed, reverse) {
    const magnitude = speed < 0 ? -speed : speed;
    let half = fromFloat(magnitude) & 0x7FFF;
    if (reverse) half |= FLOAT16_SIGN_MASK;
    return half & 0xFFFF;
}

/** Returns the speed magnitude (direction/sign bit cleared). */
export function getSpeed(half) {
    return toFloat(half & 0x7FFF);
}

/** Returns true if the direction bit is set (reverse). */
export function getDirection(half) {
    return (half & FLOAT16_SIGN_MASK) !== 0;
}

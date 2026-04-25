// Node parameter handling.
//
// Translates the JS parameters object passed to openlcb.createNode() into
// the sequence of wasm_node_set_* calls that populate the C-side scratch
// `node_parameters_t`, then commits via wasm_create_node().
//
// Design notes:
//   - protocolSupport accepts either a single number/bigint (legacy bitmask)
//     or an array of PSI.* constants (new preferred form).
//   - addressSpace* keys are optional and default to absent.  Only spell
//     out the spaces the node actually uses.
//   - configurationOptions defaults to {} (no flags).
//   - SNIP defaults to empty strings (WASM clamps to buffer size).

import {
    errorForReturnCode,
    InvalidArgumentError,
} from '../errors.js';
import { AddressSpace, PSI } from '../constants.js';

const ADDR_SPACE_FLAG_PRESENT           = 0x01;
const ADDR_SPACE_FLAG_READ_ONLY         = 0x02;
const ADDR_SPACE_FLAG_LOW_ADDRESS_VALID = 0x04;

const CFG_OPT_WRITE_UNDER_MASK          = 1 << 0;
const CFG_OPT_UNALIGNED_READS           = 1 << 1;
const CFG_OPT_UNALIGNED_WRITES          = 1 << 2;
const CFG_OPT_READ_FROM_MFG_SPACE_0xFC  = 1 << 3;
const CFG_OPT_READ_FROM_USER_SPACE_0xFB = 1 << 4;
const CFG_OPT_WRITE_TO_USER_SPACE_0xFB  = 1 << 5;
const CFG_OPT_STREAM_READ_WRITE         = 1 << 6;

// JS-key → WASM space-id mapping.  Accepts both the camelCase JS name
// and the AddressSpace.* constant form.
const ADDRESS_SPACE_KEYS = Object.freeze({
    addressSpaceConfigurationDefinitionInfo:    AddressSpace.CONFIGURATION_DEFINITION_INFO,
    addressSpaceAll:                            AddressSpace.ALL,
    addressSpaceConfigMemory:                   AddressSpace.CONFIGURATION_MEMORY,
    addressSpaceAcdiManufacturer:               AddressSpace.ACDI_MANUFACTURER_ACCESS,
    addressSpaceAcdiUser:                       AddressSpace.ACDI_USER_ACCESS,
    addressSpaceTrainFunctionDefinitionInfo:    AddressSpace.TRAIN_FUNCTION_DEFINITION_INFO,
    addressSpaceTrainFunctionConfigMemory:      AddressSpace.TRAIN_FUNCTION_CONFIGURATION_MEMORY,
    addressSpaceFirmware:                       AddressSpace.FIRMWARE,
});

/**
 * Fold an array of PSI values (or a raw bitmask) to a BigInt.
 */
function foldProtocolSupport(ps) {
    if (ps === undefined || ps === null) return 0n;
    if (Array.isArray(ps)) {
        let out = 0n;
        for (const bit of ps) out |= BigInt(bit);
        return out;
    }
    return BigInt(ps);
}

/**
 * Apply the parameter object to the WASM node builder and commit.
 * Throws a typed error on failure.  Returns nothing on success.
 *
 * @param {object} api     cwrap bundle (from wasm-api.js)
 * @param {bigint} id      48-bit node ID
 * @param {object} params  user-supplied parameters
 */
export function buildAndCreateNode(api, id, params) {
    const p = params ?? {};

    api.builderReset();

    // SNIP
    const snip = p.snip ?? {};
    api.setSnip(
        snip.mfgVersion     ?? 1,
        snip.name           ?? '',
        snip.model          ?? '',
        snip.hardwareVersion ?? '',
        snip.softwareVersion ?? '',
        snip.userVersion    ?? 1,
    );

    // Protocol Support (64-bit)
    const ps = foldProtocolSupport(p.protocolSupport);
    api.setProtocolSupport(
        Number(ps & 0xFFFFFFFFn),
        Number((ps >> 32n) & 0xFFFFFFFFn),
    );

    // Event autocreate counts
    api.setEventAutocreate(
        p.producerCountAutocreate ?? 0,
        p.consumerCountAutocreate ?? 0,
    );

    // Configuration Options
    const co = p.configurationOptions ?? {};
    let coFlags = 0;
    if (co.writeUnderMaskSupported)                coFlags |= CFG_OPT_WRITE_UNDER_MASK;
    if (co.unalignedReadsSupported)                coFlags |= CFG_OPT_UNALIGNED_READS;
    if (co.unalignedWritesSupported)               coFlags |= CFG_OPT_UNALIGNED_WRITES;
    if (co.readFromManufacturerSpace0xfcSupported) coFlags |= CFG_OPT_READ_FROM_MFG_SPACE_0xFC;
    if (co.readFromUserSpace0xfbSupported)         coFlags |= CFG_OPT_READ_FROM_USER_SPACE_0xFB;
    if (co.writeToUserSpace0xfbSupported)          coFlags |= CFG_OPT_WRITE_TO_USER_SPACE_0xFB;
    if (co.streamReadWriteSupported)               coFlags |= CFG_OPT_STREAM_READ_WRITE;
    api.setConfigurationOptions(
        coFlags,
        co.highestAddressSpace ?? 0,
        co.lowestAddressSpace  ?? 0,
        co.description ?? '',
    );

    // Address spaces — all absent by default; only call WASM for keys
    // actually present in the parameters object.
    for (const [key, spaceId] of Object.entries(ADDRESS_SPACE_KEYS)) {
        const spec = p[key];
        if (!spec) continue;
        let flags = 0;
        if (spec.present)         flags |= ADDR_SPACE_FLAG_PRESENT;
        if (spec.readOnly)        flags |= ADDR_SPACE_FLAG_READ_ONLY;
        if (spec.lowAddressValid) flags |= ADDR_SPACE_FLAG_LOW_ADDRESS_VALID;
        const rc = api.setAddressSpace(
            spaceId,
            flags,
            spec.lowAddress     ?? 0,
            spec.highestAddress ?? 0,
            spec.description    ?? '',
        );
        if (rc !== 0) {
            throw new InvalidArgumentError(
                `addressSpace ${key} (id=${spaceId}) rejected by WASM (rc=${rc})`,
            );
        }
    }

    // Commit
    const rc = api.createNode(id);
    const err = errorForReturnCode(rc, `wasm_create_node(${id.toString(16)})`);
    if (err) throw err;

    // If the node declared PSI.TRAIN_CONTROL, allocate train_state now.
    // set_dcc_address / set_speed_steps silently no-op without it.
    if (ps & BigInt(PSI.TRAIN_CONTROL)) {
        const rc2 = api.tSetup(id);
        const err2 = errorForReturnCode(rc2, `wasm_train_setup(${id.toString(16)})`);
        if (err2) throw err2;
    }
}

/**
 * Return a resolved parameters object — the same shape the caller passed
 * in, with defaults filled in.  Useful for `node.parameters`.
 */
export function resolveParameters(params) {
    const p = params ?? {};
    return Object.freeze({
        snip: Object.freeze({
            mfgVersion:       p.snip?.mfgVersion      ?? 1,
            name:             p.snip?.name            ?? '',
            model:            p.snip?.model           ?? '',
            hardwareVersion:  p.snip?.hardwareVersion ?? '',
            softwareVersion:  p.snip?.softwareVersion ?? '',
            userVersion:      p.snip?.userVersion     ?? 1,
        }),
        protocolSupport:          foldProtocolSupport(p.protocolSupport),
        producerCountAutocreate:  p.producerCountAutocreate ?? 0,
        consumerCountAutocreate:  p.consumerCountAutocreate ?? 0,
        configurationOptions:     Object.freeze({ ...(p.configurationOptions ?? {}) }),
        // Echo back whatever addressSpace* keys the caller set.
        ...(Object.fromEntries(
            Object.keys(ADDRESS_SPACE_KEYS)
                .filter((k) => p[k])
                .map((k) => [k, Object.freeze({ ...p[k] })]),
        )),
    });
}

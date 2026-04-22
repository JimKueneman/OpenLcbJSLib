// Ported from OpenLcbCLib/src/drivers/canbus/can_login_message_handler.[hc].
//
// Ten state handler functions plus LFSR helpers for CAN alias allocation.
// Invoked by CanLoginStatemachine (the dispatcher) based on node.state.runState.
//
// The state machine drives a single node through:
//   INIT -> GENERATE_ALIAS -> CID7 -> CID6 -> CID5 -> CID4
//     -> WAIT_200ms -> RID -> AMD -> LOAD_INITIALIZATION_COMPLETE
// On alias collision the dispatcher may revert to GENERATE_SEED to advance
// the LFSR and try again.
//
// `stateInfo` is the JS equivalent of the C can_statemachine_info_t:
//   {
//     node,                    // openlcb_node_t being driven
//     loginOutgoingCanMsg,     // reusable CAN frame for CID/RID/AMD
//     loginOutgoingValid,      // true when loginOutgoingCanMsg needs TX
//     currentTick,             // snapshot of the 100ms tick for the wait
//   }

import {
    RUNSTATE_GENERATE_ALIAS,
    RUNSTATE_LOAD_CHECK_ID_07,
    RUNSTATE_LOAD_CHECK_ID_06,
    RUNSTATE_LOAD_CHECK_ID_05,
    RUNSTATE_LOAD_CHECK_ID_04,
    RUNSTATE_WAIT_200ms,
    RUNSTATE_LOAD_RESERVE_ID,
    RUNSTATE_LOAD_ALIAS_MAP_DEFINITION,
    RUNSTATE_LOAD_INITIALIZATION_COMPLETE,
    RESERVED_TOP_BIT,
    CAN_CONTROL_FRAME_CID7,
    CAN_CONTROL_FRAME_CID6,
    CAN_CONTROL_FRAME_CID5,
    CAN_CONTROL_FRAME_CID4,
    CAN_CONTROL_FRAME_RID,
    CAN_CONTROL_FRAME_AMD,
} from '../../openlcb/defines.js';
import { copyNodeIdToCanPayload } from './utilities.js';

// =============================================================================
// LFSR helpers — exported for unit tests
// =============================================================================

/** Advance a 48-bit seed one step per CanFrameTransferS §6.1.3. */
export function generateSeed(startSeed) {
    const MASK24 = 0xFFFFFFn;
    const MASK8  = 0xFFn;

    let lfsr2 = startSeed & MASK24;
    let lfsr1 = (startSeed >> 24n) & MASK24;

    const temp1 = ((lfsr1 << 9n) | ((lfsr2 >> 15n) & 0x1FFn)) & MASK24;
    const temp2 = (lfsr2 << 9n) & MASK24;

    lfsr1 = lfsr1 + temp1 + 0x1B0CA3n;
    lfsr2 = lfsr2 + temp2 + 0x7A4BA9n;

    lfsr1 = (lfsr1 & MASK24) + ((lfsr2 & (MASK8 << 24n)) >> 24n);
    lfsr2 = lfsr2 & MASK24;

    return (lfsr1 << 24n) | lfsr2;
}

/** Derive a 12-bit alias (0x001-0xFFF) from a 48-bit seed. */
export function generateAlias(seed) {
    const lfsr2 = Number(seed & 0xFFFFFFn);
    const lfsr1 = Number((seed >> 24n) & 0xFFFFFFn);
    return (lfsr1 ^ lfsr2 ^ (lfsr1 >>> 12) ^ (lfsr2 >>> 12)) & 0x0FFF;
}

// =============================================================================
// State handler class
// =============================================================================

export class CanLoginMessageHandler {
    /**
     * @param {Object} deps
     * @param {AliasMappings} deps.aliasMappings required
     * @param {(alias: number, nodeId: bigint) => void} [deps.onAliasChange] optional
     */
    constructor(deps) {
        this._aliasMappings = deps.aliasMappings;
        this._onAliasChange = deps.onAliasChange ?? null;
    }

    /** State 1: seed ← Node ID, skip straight to GENERATE_ALIAS. */
    stateInit(stateInfo) {
        const node = stateInfo.node;
        node.seed = node.id;
        node.state.runState = RUNSTATE_GENERATE_ALIAS;
    }

    /** State 2: advance LFSR (entered on alias conflict retry only). */
    stateGenerateSeed(stateInfo) {
        const node = stateInfo.node;
        node.seed = generateSeed(node.seed);
        node.state.runState = RUNSTATE_GENERATE_ALIAS;
    }

    /**
     * State 3: derive 12-bit alias, reject 0 and collisions with siblings,
     * register mapping, notify, advance.
     */
    stateGenerateAlias(stateInfo) {
        const node = stateInfo.node;
        node.alias = generateAlias(node.seed);

        while (node.alias === 0 || this._aliasMappings.findMappingByAlias(node.alias) !== null) {
            node.seed = generateSeed(node.seed);
            node.alias = generateAlias(node.seed);
        }

        this._aliasMappings.register(node.alias, node.id);
        if (this._onAliasChange) this._onAliasChange(node.alias, node.id);
        node.state.runState = RUNSTATE_LOAD_CHECK_ID_07;
    }

    /** State 4: CID7 frame carrying Node ID bits 47-36. */
    stateLoadCid07(stateInfo) {
        const node = stateInfo.node;
        const idHigh = Number((node.id >> 24n) & 0xFFFFFFn);
        stateInfo.loginOutgoingCanMsg.payloadCount = 0;
        stateInfo.loginOutgoingCanMsg.identifier =
            (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_CID7 | (idHigh & 0xFFF000) | node.alias) >>> 0;
        stateInfo.loginOutgoingValid = true;
        node.state.runState = RUNSTATE_LOAD_CHECK_ID_06;
    }

    /** State 5: CID6 frame carrying Node ID bits 35-24. */
    stateLoadCid06(stateInfo) {
        const node = stateInfo.node;
        const idMid = Number((node.id >> 12n) & 0xFFFFFFn);
        stateInfo.loginOutgoingCanMsg.payloadCount = 0;
        stateInfo.loginOutgoingCanMsg.identifier =
            (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_CID6 | (idMid & 0xFFF000) | node.alias) >>> 0;
        stateInfo.loginOutgoingValid = true;
        node.state.runState = RUNSTATE_LOAD_CHECK_ID_05;
    }

    /** State 6: CID5 frame carrying Node ID bits 23-12. */
    stateLoadCid05(stateInfo) {
        const node = stateInfo.node;
        const idLow = Number(node.id & 0xFFFFFFn);
        stateInfo.loginOutgoingCanMsg.payloadCount = 0;
        stateInfo.loginOutgoingCanMsg.identifier =
            (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_CID5 | (idLow & 0xFFF000) | node.alias) >>> 0;
        stateInfo.loginOutgoingValid = true;
        node.state.runState = RUNSTATE_LOAD_CHECK_ID_04;
    }

    /** State 7: CID4 frame carrying Node ID bits 11-0. Snapshot tick for wait. */
    stateLoadCid04(stateInfo) {
        const node = stateInfo.node;
        const shifted = Number((node.id << 12n) & 0xFFFFFFn);
        stateInfo.loginOutgoingCanMsg.payloadCount = 0;
        stateInfo.loginOutgoingCanMsg.identifier =
            (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_CID4 | (shifted & 0xFFF000) | node.alias) >>> 0;
        node.timerticks = stateInfo.currentTick & 0xFF;
        stateInfo.loginOutgoingValid = true;
        node.state.runState = RUNSTATE_WAIT_200ms;
    }

    /** State 8: wait until >200ms elapsed (C uses >2 ticks = ≥300ms real-world). */
    stateWait200ms(stateInfo) {
        const node = stateInfo.node;
        const elapsed = (stateInfo.currentTick - node.timerticks) & 0xFF;
        if (elapsed > 2) {
            node.state.runState = RUNSTATE_LOAD_RESERVE_ID;
        }
    }

    /** State 9: RID frame. */
    stateLoadRid(stateInfo) {
        const node = stateInfo.node;
        stateInfo.loginOutgoingCanMsg.identifier =
            (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_RID | node.alias) >>> 0;
        stateInfo.loginOutgoingCanMsg.payloadCount = 0;
        stateInfo.loginOutgoingValid = true;
        node.state.runState = RUNSTATE_LOAD_ALIAS_MAP_DEFINITION;
    }

    /** State 10: AMD frame + mark node permitted. Final state of CAN login. */
    stateLoadAmd(stateInfo) {
        const node = stateInfo.node;
        stateInfo.loginOutgoingCanMsg.identifier =
            (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_AMD | node.alias) >>> 0;
        copyNodeIdToCanPayload(stateInfo.loginOutgoingCanMsg, node.id, 0);
        stateInfo.loginOutgoingValid = true;
        node.state.permitted = true;

        const mapping = this._aliasMappings.findMappingByAlias(node.alias);
        if (mapping) mapping.isPermitted = true;

        node.state.runState = RUNSTATE_LOAD_INITIALIZATION_COMPLETE;
    }
}

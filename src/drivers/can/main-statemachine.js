// Ported from OpenLcbCLib/src/drivers/canbus/can_main_statemachine.[hc].
//
// Cooperative dispatcher that coordinates the CAN layer each main-loop tick.
// Priority order (first handler to do work returns immediately):
//
//   1. Listener verification (runs unconditionally — advances rate-limit)
//   2. Resolve duplicate aliases (unregister + node reset)
//   3. Transmit one CAN frame from the TX FIFO
//   4. Transmit the pending login frame (CID/RID/AMD)
//   5. Enumerate first node, run one login state
//   6. Enumerate next node, run one login state
//
// Lock/unlock callbacks from the C port are dropped — the browser runtime
// is single-threaded.

import {
    RUNSTATE_GENERATE_SEED,
    RUNSTATE_LOAD_INITIALIZATION_COMPLETE,
    RESERVED_TOP_BIT,
    CAN_CONTROL_FRAME_AME,
    CAN_CONTROL_FRAME_AMD,
    CAN_STATEMACHINE_NODE_ENUMRATOR_KEY,
} from '../../openlcb/defines.js';
import { createCanMsg } from './types.js';
import { clearCanMessage, copyNodeIdToCanPayload } from './utilities.js';

export class CanMainStatemachine {
    /**
     * @param {Object} deps
     * @param {NodePool}             deps.nodePool            required
     * @param {AliasMappings}        deps.aliasMappings       required
     * @param {CanBufferFifo}        deps.canTxFifo           required — outgoing CAN frames
     * @param {CanLoginStatemachine} deps.loginStatemachine   required — per-node login driver
     * @param {(canMsg) => boolean}  deps.sendCanMessage      required — hardware TX (wraps TX handler)
     * @param {() => number}         deps.getCurrentTick      required — global 100ms tick
     * @param {AliasMappingListener} [deps.listener]          optional — listener alias table
     */
    constructor(deps) {
        this._nodePool = deps.nodePool;
        this._aliasMappings = deps.aliasMappings;
        this._canTxFifo = deps.canTxFifo;
        this._loginStatemachine = deps.loginStatemachine;
        this._sendCanMessage = deps.sendCanMessage;
        this._getCurrentTick = deps.getCurrentTick;
        this._listener = deps.listener ?? null;

        // One statically-scoped CAN frame for login CID/RID/AMD output.
        this._loginCanMsg = createCanMsg();

        // Shared state carried across state calls — mirrors can_statemachine_info_t.
        this._stateInfo = {
            node: null,
            loginOutgoingCanMsg: this._loginCanMsg,
            loginOutgoingValid: false,
            outgoingCanMsg: null, // retained on TX failure for retry
            currentTick: 0,
        };
    }

    /** Access the internal state info (testing/debug). Do not mutate. */
    getStateInfo() {
        return this._stateInfo;
    }

    // -------------------------------------------------------------------------
    // Public: run one cooperative iteration
    // -------------------------------------------------------------------------

    run() {
        // Listener prober advances rate-limit counters even when there's
        // other traffic to process.
        this._handleListenerVerification();

        if (this._handleDuplicateAliases()) return;
        if (this._handleOutgoingCanMessage()) return;
        if (this._handleLoginOutgoingCanMessage()) return;
        if (this._handleTryEnumerateFirstNode()) return;
        if (this._handleTryEnumerateNextNode()) return;
    }

    // -------------------------------------------------------------------------
    // Handlers (exposed for unit tests)
    // -------------------------------------------------------------------------

    /** Scan the alias mapping table; reset any node that flagged a duplicate. */
    handleDuplicateAliases() { return this._handleDuplicateAliases(); }
    _handleDuplicateAliases() {
        if (!this._aliasMappings.hasDuplicateAlias) return false;

        let found = false;
        for (const entry of this._aliasMappings.getList()) {
            if (entry.alias > 0 && entry.isDuplicate) {
                const alias = entry.alias;
                this._aliasMappings.unregister(alias);
                this._resetNode(this._nodePool.findByAlias(alias));
                found = true;
            }
        }
        this._aliasMappings.clearHasDuplicateAliasFlag();
        return found;
    }

    handleOutgoingCanMessage() { return this._handleOutgoingCanMessage(); }
    _handleOutgoingCanMessage() {
        if (!this._stateInfo.outgoingCanMsg) {
            this._stateInfo.outgoingCanMsg = this._canTxFifo.pop();
        }
        if (this._stateInfo.outgoingCanMsg) {
            if (this._sendCanMessage(this._stateInfo.outgoingCanMsg)) {
                this._stateInfo.outgoingCanMsg = null;
            }
            return true;
        }
        return false;
    }

    handleLoginOutgoingCanMessage() { return this._handleLoginOutgoingCanMessage(); }
    _handleLoginOutgoingCanMessage() {
        if (this._stateInfo.loginOutgoingValid) {
            if (this._sendCanMessage(this._stateInfo.loginOutgoingCanMsg)) {
                this._stateInfo.loginOutgoingValid = false;
            }
            return true;
        }
        return false;
    }

    handleTryEnumerateFirstNode() { return this._handleTryEnumerateFirstNode(); }
    _handleTryEnumerateFirstNode() {
        if (!this._stateInfo.node) {
            this._stateInfo.node = this._nodePool.getFirst(CAN_STATEMACHINE_NODE_ENUMRATOR_KEY);
            if (!this._stateInfo.node) return true;

            if (this._stateInfo.node.state.runState < RUNSTATE_LOAD_INITIALIZATION_COMPLETE) {
                this._stateInfo.currentTick = this._getCurrentTick();
                this._loginStatemachine.run(this._stateInfo);
            }
            return true;
        }
        return false;
    }

    handleTryEnumerateNextNode() { return this._handleTryEnumerateNextNode(); }
    _handleTryEnumerateNextNode() {
        this._stateInfo.node = this._nodePool.getNext(CAN_STATEMACHINE_NODE_ENUMRATOR_KEY);
        if (!this._stateInfo.node) return true;

        if (this._stateInfo.node.state.runState < RUNSTATE_LOAD_INITIALIZATION_COMPLETE) {
            this._stateInfo.currentTick = this._getCurrentTick();
            this._loginStatemachine.run(this._stateInfo);
        }
        return false;
    }

    handleListenerVerification() { return this._handleListenerVerification(); }
    _handleListenerVerification() {
        if (!this._listener) return false;

        const probeId = this._listener.checkOneVerification(this._getCurrentTick());
        if (probeId === 0n) return false;

        const sourceNode = this._nodePool.getFirst(CAN_STATEMACHINE_NODE_ENUMRATOR_KEY);
        if (!sourceNode || sourceNode.alias === 0) return false;

        const ame = createCanMsg();
        ame.identifier = (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_AME | sourceNode.alias) >>> 0;
        copyNodeIdToCanPayload(ame, probeId, 0);
        this._canTxFifo.push(ame);
        return true;
    }

    // -------------------------------------------------------------------------
    // Self-originated global AME (§6.2.3)
    // -------------------------------------------------------------------------

    /**
     * Queue a global AME, flushing the listener cache and re-emitting AMDs
     * for local virtual nodes so external nodes learn about them without
     * waiting for self-echoed frames (which the CAN hardware never produces).
     */
    sendGlobalAliasEnquiry() {
        if (this._listener) this._listener.flushAliases();

        for (const entry of this._aliasMappings.getList()) {
            if (entry.alias !== 0 && entry.isPermitted) {
                if (this._listener) this._listener.setAlias(entry.nodeId, entry.alias);

                const amd = createCanMsg();
                amd.identifier = (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_AMD | entry.alias) >>> 0;
                copyNodeIdToCanPayload(amd, entry.nodeId, 0);
                this._canTxFifo.push(amd);
            }
        }

        const ame = createCanMsg();
        ame.identifier = (RESERVED_TOP_BIT | CAN_CONTROL_FRAME_AME) >>> 0;
        ame.payloadCount = 0;
        this._canTxFifo.push(ame);
    }

    // -------------------------------------------------------------------------
    // Node reset helper (duplicate alias handling)
    // -------------------------------------------------------------------------

    _resetNode(node) {
        if (!node) return;

        node.alias = 0;
        node.state.permitted = false;
        node.state.initialized = false;
        node.state.duplicateIdDetected = false;
        node.state.firmwareUpgradeActive = false;
        node.state.resendDatagram = false;
        node.state.openlcbDatagramAckSent = false;
        node.lastReceivedDatagram = null;
        node.state.runState = RUNSTATE_GENERATE_SEED;
    }
}

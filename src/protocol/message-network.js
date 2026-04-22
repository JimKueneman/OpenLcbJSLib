// Ported from OpenLcbCLib/src/openlcb/protocol_message_network.[hc].
//
// Core message-network protocol: Verify Node ID (global/addressed), Verified
// Node ID, Protocol Support Inquiry/Reply, Initialization Complete, Optional
// Interaction Rejected, Terminate Due To Error. Also emits a Duplicate Node
// Detected PC Event Report when another node claims our Node ID.
//
// Each handler mutates the `statemachine_info` context:
//   statemachineInfo = {
//     node,                     // this node
//     incoming: { msg },         // wire message being processed
//     outgoing: { msg, valid },  // reply to queue if valid === true
//     currentTick,
//   }

import {
    MTI_PC_EVENT_REPORT,
    MTI_VERIFIED_NODE_ID,
    MTI_VERIFIED_NODE_ID_SIMPLE,
    MTI_PROTOCOL_SUPPORT_REPLY,
    EVENT_ID_DUPLICATE_NODE_DETECTED,
    PSI_SIMPLE,
    PSI_FIRMWARE_UPGRADE,
    PSI_FIRMWARE_UPGRADE_ACTIVE,
} from '../openlcb/defines.js';
import {
    loadOpenlcbMessage,
    copyNodeIdToPayload,
    copyEventIdToPayload,
    copyByteToPayload,
    extractNodeIdFromPayload,
    extractWordFromPayload,
} from '../openlcb/utilities.js';

export class ProtocolMessageNetwork {
    /**
     * @param {Object} [deps]
     * @param {(node, sourceId, errorCode, rejectedMti) => void} [deps.onOptionalInteractionRejected]
     * @param {(node, sourceId, errorCode, rejectedMti) => void} [deps.onTerminateDueToError]
     */
    constructor(deps = {}) {
        this._onOptionalInteractionRejected = deps.onOptionalInteractionRejected ?? null;
        this._onTerminateDueToError = deps.onTerminateDueToError ?? null;
    }

    // -------------------------------------------------------------------------
    // Internal builders
    // -------------------------------------------------------------------------

    /** Fire duplicate-node-detected PCER once per boot. */
    _loadDuplicateNodeId(sm) {
        if (sm.node.state.duplicateIdDetected) return;

        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_PC_EVENT_REPORT
        );
        copyEventIdToPayload(sm.outgoing.msg, EVENT_ID_DUPLICATE_NODE_DETECTED);

        sm.node.state.duplicateIdDetected = true;
        sm.outgoing.valid = true;
    }

    /**
     * Build a Verified Node ID reply. Per MessageNetworkS §3.4.2, the reply
     * is always unaddressed even when the triggering Verify was addressed.
     */
    _loadVerifiedNodeId(sm) {
        const params = sm.node.parameters;
        const mti = (params && (params.protocolSupport & PSI_SIMPLE))
            ? MTI_VERIFIED_NODE_ID_SIMPLE
            : MTI_VERIFIED_NODE_ID;

        loadOpenlcbMessage(sm.outgoing.msg, sm.node.alias, sm.node.id, 0, 0n, mti);
        copyNodeIdToPayload(sm.outgoing.msg, sm.node.id, 0);
        sm.outgoing.valid = true;
    }

    // -------------------------------------------------------------------------
    // Public handlers (one per MTI)
    // -------------------------------------------------------------------------

    handleInitializationComplete(sm) {
        if (extractNodeIdFromPayload(sm.incoming.msg, 0) === sm.node.id) {
            this._loadDuplicateNodeId(sm);
            return;
        }
        sm.outgoing.valid = false;
    }

    // Same logic as full Initialization Complete — duplicate check only.
    handleInitializationCompleteSimple(sm) {
        this.handleInitializationComplete(sm);
    }

    handleProtocolSupportInquiry(sm) {
        let flags = sm.node.parameters.protocolSupport;
        if (sm.node.state.firmwareUpgradeActive) {
            flags = (flags & ~PSI_FIRMWARE_UPGRADE) | PSI_FIRMWARE_UPGRADE_ACTIVE;
        }

        loadOpenlcbMessage(
            sm.outgoing.msg,
            sm.node.alias, sm.node.id,
            sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
            MTI_PROTOCOL_SUPPORT_REPLY
        );
        // Six bytes, big-endian: upper 24 bits into bytes 0-2, lower 24 bits into 3-5.
        copyByteToPayload(sm.outgoing.msg, (flags >>> 16) & 0xFF, 0);
        copyByteToPayload(sm.outgoing.msg, (flags >>>  8) & 0xFF, 1);
        copyByteToPayload(sm.outgoing.msg,  flags         & 0xFF, 2);
        copyByteToPayload(sm.outgoing.msg, 0, 3); // bits 47-40 (unused)
        copyByteToPayload(sm.outgoing.msg, 0, 4); // bits 39-32 (unused)
        copyByteToPayload(sm.outgoing.msg, 0, 5); // bits 31-24 (unused)
        sm.outgoing.valid = true;
    }

    handleProtocolSupportReply(sm) {
        sm.outgoing.valid = false;
    }

    /** Reply if payload is empty (unaddressed probe) or contains our Node ID. */
    handleVerifyNodeIdGlobal(sm) {
        if (sm.incoming.msg.payloadCount > 0) {
            if (extractNodeIdFromPayload(sm.incoming.msg, 0) === sm.node.id) {
                this._loadVerifiedNodeId(sm);
                return;
            }
            sm.outgoing.valid = false;
            return;
        }
        this._loadVerifiedNodeId(sm);
    }

    /** Addressed variant: always reply with our Node ID. */
    handleVerifyNodeIdAddressed(sm) {
        this._loadVerifiedNodeId(sm);
    }

    /** Received a Verified Node ID — check for a duplicate of our ID. */
    handleVerifiedNodeId(sm) {
        if (extractNodeIdFromPayload(sm.incoming.msg, 0) === sm.node.id) {
            this._loadDuplicateNodeId(sm);
            return;
        }
        sm.outgoing.valid = false;
    }

    handleOptionalInteractionRejected(sm) {
        sm.outgoing.valid = false;
        if (!this._onOptionalInteractionRejected) return;

        let errorCode = 0;
        let rejectedMti = 0;
        const msg = sm.incoming.msg;
        if (msg.payloadCount >= 2) errorCode = extractWordFromPayload(msg, 0);
        if (msg.payloadCount >= 4) rejectedMti = extractWordFromPayload(msg, 2);

        this._onOptionalInteractionRejected(sm.node, msg.sourceId, errorCode, rejectedMti);
    }

    handleTerminateDueToError(sm) {
        sm.outgoing.valid = false;
        if (!this._onTerminateDueToError) return;

        let errorCode = 0;
        let rejectedMti = 0;
        const msg = sm.incoming.msg;
        if (msg.payloadCount >= 2) errorCode = extractWordFromPayload(msg, 0);
        if (msg.payloadCount >= 4) rejectedMti = extractWordFromPayload(msg, 2);

        this._onTerminateDueToError(sm.node, msg.sourceId, errorCode, rejectedMti);
    }
}

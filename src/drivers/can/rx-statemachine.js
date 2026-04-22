// Ported from OpenLcbCLib/src/drivers/canbus/can_rx_statemachine.[hc].
//
// Classifier that takes a raw incoming CAN frame and dispatches it to the
// correct method on a CanRxMessageHandler (Phase 2). Distinguishes OpenLCB
// messages from CAN control frames, applies the addressed-vs-global split,
// and translates the multi-frame bits into single/first/middle/last calls.

import {
    MASK_CAN_FRAME_TYPE,
    MASK_CAN_FRAME_SEQUENCE_NUMBER,
    MASK_CAN_VARIABLE_FIELD,
    MASK_CAN_DEST_ADDRESS_PRESENT,
    MASK_MULTIFRAME_BITS,
    OPENLCB_MESSAGE_STANDARD_FRAME_TYPE,
    CAN_FRAME_TYPE_DATAGRAM_ONLY,
    CAN_FRAME_TYPE_DATAGRAM_FIRST,
    CAN_FRAME_TYPE_DATAGRAM_MIDDLE,
    CAN_FRAME_TYPE_DATAGRAM_FINAL,
    CAN_FRAME_TYPE_STREAM,
    CAN_CONTROL_FRAME_RID,
    CAN_CONTROL_FRAME_AMD,
    CAN_CONTROL_FRAME_AME,
    CAN_CONTROL_FRAME_AMR,
    CAN_CONTROL_FRAME_ERROR_INFO_REPORT_0,
    CAN_CONTROL_FRAME_ERROR_INFO_REPORT_1,
    CAN_CONTROL_FRAME_ERROR_INFO_REPORT_2,
    CAN_CONTROL_FRAME_ERROR_INFO_REPORT_3,
    CAN_CONTROL_FRAME_CID7,
    CAN_CONTROL_FRAME_CID6,
    CAN_CONTROL_FRAME_CID5,
    CAN_CONTROL_FRAME_CID4,
    CAN_CONTROL_FRAME_CID3,
    CAN_CONTROL_FRAME_CID2,
    CAN_CONTROL_FRAME_CID1,
    MULTIFRAME_ONLY,
    MULTIFRAME_FIRST,
    MULTIFRAME_MIDDLE,
    MULTIFRAME_FINAL,
    MTI_SIMPLE_NODE_INFO_REPLY,
} from '../../openlcb/defines.js';
import { PAYLOAD_TYPE } from '../../openlcb/types.js';
import {
    isOpenlcbMessage,
    extractDestAliasFromCanMessage,
} from './utilities.js';
import {
    CAN_MTI_PCER_WITH_PAYLOAD_FIRST,
    CAN_MTI_PCER_WITH_PAYLOAD_MIDDLE,
    CAN_MTI_PCER_WITH_PAYLOAD_LAST,
} from './types.js';

/** Offset for CAN payload when the destination alias lives in bytes 0-1 (standard addressed frames). */
const OFFSET_DEST_ID_IN_PAYLOAD = 2;
/** Offset when the destination alias is in the identifier (datagrams and streams). */
const OFFSET_DEST_ID_IN_IDENTIFIER = 0;
/** Offset for global unaddressed frames. */
const OFFSET_NO_DEST_ID = 0;

function extractCanMti(canMsg) {
    return (canMsg.identifier >>> 12) & 0x0FFF;
}

export class CanRxStatemachine {
    /**
     * @param {Object} deps
     * @param {CanRxMessageHandler} deps.rxHandler required — handlers for single/first/middle/last/stream/legacy-snip and control frames
     * @param {AliasMappings} deps.aliasMappings   required — used to drop frames addressed to nodes we don't own
     * @param {(canMsg) => void} [deps.onReceive]  optional tap for monitoring/logging
     */
    constructor(deps) {
        this._rx = deps.rxHandler;
        this._aliasMappings = deps.aliasMappings;
        this._onReceive = deps.onReceive ?? null;
    }

    /** Entry point — call with a freshly decoded incoming CAN frame. */
    handleFrame(canMsg) {
        if (this._onReceive) this._onReceive(canMsg);

        if (isOpenlcbMessage(canMsg)) {
            this._handleOpenlcbFrame(canMsg);
        } else {
            this._handleControlFrame(canMsg);
        }
    }

    // -------------------------------------------------------------------------
    // OpenLCB frame dispatch (CAN_OPENLCB_MSG bit set)
    // -------------------------------------------------------------------------

    _handleOpenlcbFrame(canMsg) {
        switch (canMsg.identifier & MASK_CAN_FRAME_TYPE) {
            case OPENLCB_MESSAGE_STANDARD_FRAME_TYPE: {
                if (canMsg.identifier & MASK_CAN_DEST_ADDRESS_PRESENT) {
                    // Drop frames addressed to nodes we don't own.
                    const destAlias = extractDestAliasFromCanMessage(canMsg);
                    if (!this._aliasMappings.findMappingByAlias(destAlias)) return;
                    this._handleStandardAddressed(canMsg, extractCanMti(canMsg));
                } else {
                    this._handleStandardGlobal(canMsg, extractCanMti(canMsg));
                }
                return;
            }

            case CAN_FRAME_TYPE_DATAGRAM_ONLY:
                if (!this._addressedToUs(canMsg)) return;
                this._rx.singleFrame(canMsg, OFFSET_DEST_ID_IN_IDENTIFIER, PAYLOAD_TYPE.BASIC);
                return;

            case CAN_FRAME_TYPE_DATAGRAM_FIRST:
                if (!this._addressedToUs(canMsg)) return;
                this._rx.firstFrame(canMsg, OFFSET_DEST_ID_IN_IDENTIFIER, PAYLOAD_TYPE.DATAGRAM);
                return;

            case CAN_FRAME_TYPE_DATAGRAM_MIDDLE:
                if (!this._addressedToUs(canMsg)) return;
                this._rx.middleFrame(canMsg, OFFSET_DEST_ID_IN_IDENTIFIER);
                return;

            case CAN_FRAME_TYPE_DATAGRAM_FINAL:
                if (!this._addressedToUs(canMsg)) return;
                this._rx.lastFrame(canMsg, OFFSET_DEST_ID_IN_IDENTIFIER);
                return;

            case CAN_FRAME_TYPE_STREAM:
                if (!this._addressedToUs(canMsg)) return;
                this._rx.streamFrame(canMsg, OFFSET_DEST_ID_IN_IDENTIFIER, PAYLOAD_TYPE.STREAM);
                return;

            default:
                return;
        }
    }

    _addressedToUs(canMsg) {
        const destAlias = extractDestAliasFromCanMessage(canMsg);
        return this._aliasMappings.findMappingByAlias(destAlias) !== null;
    }

    _handleStandardAddressed(canMsg, canMti) {
        // Multi-frame bits are the high nibble of payload byte 0.
        switch (canMsg.payload[0] & MASK_MULTIFRAME_BITS) {
            case MULTIFRAME_ONLY:
                if (canMti === MTI_SIMPLE_NODE_INFO_REPLY) {
                    this._rx.canLegacySnip(canMsg, OFFSET_DEST_ID_IN_PAYLOAD, PAYLOAD_TYPE.SNIP);
                } else {
                    this._rx.singleFrame(canMsg, OFFSET_DEST_ID_IN_PAYLOAD, PAYLOAD_TYPE.BASIC);
                }
                return;

            case MULTIFRAME_FIRST:
                this._rx.firstFrame(
                    canMsg,
                    OFFSET_DEST_ID_IN_PAYLOAD,
                    canMti === MTI_SIMPLE_NODE_INFO_REPLY ? PAYLOAD_TYPE.SNIP : PAYLOAD_TYPE.BASIC
                );
                return;

            case MULTIFRAME_MIDDLE:
                this._rx.middleFrame(canMsg, OFFSET_DEST_ID_IN_PAYLOAD);
                return;

            case MULTIFRAME_FINAL:
                this._rx.lastFrame(canMsg, OFFSET_DEST_ID_IN_PAYLOAD);
                return;

            default:
                return;
        }
    }

    _handleStandardGlobal(canMsg, canMti) {
        // PCER-with-payload is the only global message that spans multiple CAN frames.
        switch (canMti) {
            case CAN_MTI_PCER_WITH_PAYLOAD_FIRST:
                this._rx.firstFrame(canMsg, OFFSET_NO_DEST_ID, PAYLOAD_TYPE.SNIP);
                return;
            case CAN_MTI_PCER_WITH_PAYLOAD_MIDDLE:
                this._rx.middleFrame(canMsg, OFFSET_NO_DEST_ID);
                return;
            case CAN_MTI_PCER_WITH_PAYLOAD_LAST:
                this._rx.lastFrame(canMsg, OFFSET_NO_DEST_ID);
                return;
            default:
                this._rx.singleFrame(canMsg, OFFSET_NO_DEST_ID, PAYLOAD_TYPE.BASIC);
                return;
        }
    }

    // -------------------------------------------------------------------------
    // CAN control frames (CAN_OPENLCB_MSG bit clear)
    // -------------------------------------------------------------------------

    _handleControlFrame(canMsg) {
        if ((canMsg.identifier & MASK_CAN_FRAME_SEQUENCE_NUMBER) === 0) {
            this._handleControlVariableField(canMsg);
        } else {
            this._handleControlCid(canMsg);
        }
    }

    _handleControlVariableField(canMsg) {
        switch (canMsg.identifier & MASK_CAN_VARIABLE_FIELD) {
            case CAN_CONTROL_FRAME_RID: this._rx.ridFrame(canMsg); return;
            case CAN_CONTROL_FRAME_AMD: this._rx.amdFrame(canMsg); return;
            case CAN_CONTROL_FRAME_AME: this._rx.ameFrame(canMsg); return;
            case CAN_CONTROL_FRAME_AMR: this._rx.amrFrame(canMsg); return;
            case CAN_CONTROL_FRAME_ERROR_INFO_REPORT_0:
            case CAN_CONTROL_FRAME_ERROR_INFO_REPORT_1:
            case CAN_CONTROL_FRAME_ERROR_INFO_REPORT_2:
            case CAN_CONTROL_FRAME_ERROR_INFO_REPORT_3:
                this._rx.errorInfoReportFrame(canMsg);
                return;
            default:
                return;
        }
    }

    _handleControlCid(canMsg) {
        switch (canMsg.identifier & MASK_CAN_FRAME_SEQUENCE_NUMBER) {
            case CAN_CONTROL_FRAME_CID7:
            case CAN_CONTROL_FRAME_CID6:
            case CAN_CONTROL_FRAME_CID5:
            case CAN_CONTROL_FRAME_CID4:
            case CAN_CONTROL_FRAME_CID3:
            case CAN_CONTROL_FRAME_CID2:
            case CAN_CONTROL_FRAME_CID1:
                this._rx.cidFrame(canMsg);
                return;
            default:
                return;
        }
    }
}

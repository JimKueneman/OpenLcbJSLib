// Ported from OpenLcbCLib/src/openlcb/openlcb_application.[hc].
//
// Thin application-layer API that applications call to:
//   - Register / clear consumer and producer events and ranges on a node.
//   - Send PC Event Reports, teach events, Initialization Complete, and
//     arbitrary MTI-carrying event messages.
//   - Read / write configuration memory via the application-provided
//     callbacks (same callbacks the config-mem protocol handlers use).
//
// The C port uses a single file-scope `_interface` pointer set by
// `OpenLcbApplication_initialize()`. The JS port wraps that into a class so
// multiple instances can coexist cleanly (e.g. tests) without hidden state.

import {
    MTI_PC_EVENT_REPORT,
    MTI_EVENT_LEARN,
    MTI_INITIALIZATION_COMPLETE,
    MTI_INITIALIZATION_COMPLETE_SIMPLE,
    PSI_SIMPLE,
    NULL_NODE_ID,
} from './defines.js';
import { PAYLOAD_TYPE, createMessage, createEvent, createEventRange } from './types.js';
import {
    loadOpenlcbMessage,
    copyEventIdToPayload,
    copyNodeIdToPayload,
} from './utilities.js';

/** Sentinel for registration-full (C returns 0xFFFF). */
export const REGISTRATION_FULL = 0xFFFF;

export class OpenLcbApplication {
    /**
     * @param {Object} deps
     * @param {(msg) => boolean} deps.sendOpenlcbMsg required
     * @param {(node, address, count, buffer) => number} [deps.configMemoryRead]
     * @param {(node, address, count, buffer) => number} [deps.configMemoryWrite]
     */
    constructor(deps) {
        this._sendOpenlcbMsg = deps.sendOpenlcbMsg;
        this._configMemoryRead = deps.configMemoryRead ?? null;
        this._configMemoryWrite = deps.configMemoryWrite ?? null;
    }

    // -------------------------------------------------------------------------
    // Consumer / producer event registration
    // -------------------------------------------------------------------------

    clearConsumerEventIds(node) { node.consumers.count = 0; node.consumers.list.length = 0; }
    clearProducerEventIds(node) { node.producers.count = 0; node.producers.list.length = 0; }

    /** Register a consumer event. Returns the 0-based index. */
    registerConsumerEventId(node, eventId, eventStatus) {
        const idx = node.consumers.count;
        node.consumers.list[idx] = createEvent(eventId, eventStatus);
        node.consumers.count = idx + 1;
        return idx;
    }

    /** Register a producer event. Returns the 0-based index. */
    registerProducerEventId(node, eventId, eventStatus) {
        const idx = node.producers.count;
        node.producers.list[idx] = createEvent(eventId, eventStatus);
        node.producers.count = idx + 1;
        return idx;
    }

    clearConsumerRanges(node) { node.consumers.rangeCount = 0; node.consumers.rangeList.length = 0; }
    clearProducerRanges(node) { node.producers.rangeCount = 0; node.producers.rangeList.length = 0; }

    /** Register a consumer range (base event ID + size). */
    registerConsumerRange(node, eventIdBase, rangeSize) {
        const idx = node.consumers.rangeCount;
        node.consumers.rangeList[idx] = createEventRange(eventIdBase, rangeSize);
        node.consumers.rangeCount = idx + 1;
        return true;
    }

    /** Register a producer range (base event ID + size). */
    registerProducerRange(node, eventIdBase, rangeSize) {
        const idx = node.producers.rangeCount;
        node.producers.rangeList[idx] = createEventRange(eventIdBase, rangeSize);
        node.producers.rangeCount = idx + 1;
        return true;
    }

    // -------------------------------------------------------------------------
    // Event transmission
    // -------------------------------------------------------------------------

    /** Send a global event message with an arbitrary MTI (8-byte event ID payload). */
    sendEventWithMti(node, eventId, mti) {
        const msg = createMessage({ payloadType: PAYLOAD_TYPE.BASIC });
        loadOpenlcbMessage(msg, node.alias, node.id, 0, NULL_NODE_ID, mti);
        copyEventIdToPayload(msg, eventId);
        return this._sendOpenlcbMsg(msg);
    }

    /** Send a Producer/Consumer Event Report (MTI 0x05B4). */
    sendEventPcReport(node, eventId) {
        return this.sendEventWithMti(node, eventId, MTI_PC_EVENT_REPORT);
    }

    /** Send a Learn Event / teach message (MTI 0x0594). */
    sendTeachEvent(node, eventId) {
        return this.sendEventWithMti(node, eventId, MTI_EVENT_LEARN);
    }

    /**
     * Send Initialization Complete (full or simple variant based on PSI_SIMPLE).
     * 6-byte payload = the node's Node ID.
     */
    sendInitializationEvent(node) {
        const mti = (node.parameters && (node.parameters.protocolSupport & PSI_SIMPLE))
            ? MTI_INITIALIZATION_COMPLETE_SIMPLE
            : MTI_INITIALIZATION_COMPLETE;
        const msg = createMessage({ payloadType: PAYLOAD_TYPE.BASIC });
        loadOpenlcbMessage(msg, node.alias, node.id, 0, NULL_NODE_ID, mti);
        copyNodeIdToPayload(msg, node.id, 0);
        msg.payloadCount = 6;
        return this._sendOpenlcbMsg(msg);
    }

    // -------------------------------------------------------------------------
    // Configuration memory pass-through
    // -------------------------------------------------------------------------

    readConfigurationMemory(node, address, count, buffer) {
        if (!this._configMemoryRead) return REGISTRATION_FULL;
        return this._configMemoryRead(node, address, count, buffer);
    }

    writeConfigurationMemory(node, address, count, buffer) {
        if (!this._configMemoryWrite) return REGISTRATION_FULL;
        return this._configMemoryWrite(node, address, count, buffer);
    }
}

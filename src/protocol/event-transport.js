// Ported from OpenLcbCLib/src/openlcb/protocol_event_transport.[hc].
//
// Event Transport protocol — Producer/Consumer Identify, PCER, Event Learn,
// Events Identify enumeration, and the full range of Producer/Consumer
// Identified (Set/Clear/Unknown/Reserved + Range) handlers.
//
// Every callback is optional — the library processes the wire messages
// regardless. Callbacks fire when specific application events need to know.
// `_testForConsumedEvent` cross-dispatches a producer state change into the
// consumed-event callback when our node consumes the same event.

import {
    MTI_PRODUCER_RANGE_IDENTIFIED,
    MTI_CONSUMER_RANGE_IDENTIFIED,
    MTI_CONSUMER_IDENTIFIED_UNKNOWN,
    MTI_PRODUCER_IDENTIFIED_UNKNOWN,
    MTI_PRODUCER_IDENTIFIED_SET,
    MTI_PRODUCER_IDENTIFIED_CLEAR,
    MTI_CONSUMER_IDENTIFIED_SET,
    MTI_CONSUMER_IDENTIFIED_CLEAR,
} from '../openlcb/defines.js';
import { EVENT_STATUS } from '../openlcb/types.js';
import {
    loadOpenlcbMessage,
    copyEventIdToPayload,
    extractEventIdFromPayload,
    findProducerEventIndex,
    findConsumerEventIndex,
    isEventIdInProducerRanges,
    isEventIdInConsumerRanges,
    generateEventRangeId,
} from '../openlcb/utilities.js';

/** Payload size of the Event ID portion of PCER-with-payload. */
const LEN_EVENT_ID = 8;

export class ProtocolEventTransport {
    /**
     * All callbacks are optional. See C interface_openlcb_protocol_event_transport_t
     * for the full list. Accepted signatures (node, eventId[, status, payload]).
     */
    constructor(deps = {}) {
        this._cb = deps;
    }

    _fire(name, ...args) {
        const fn = this._cb[name];
        if (fn) fn(...args);
    }

    // -------------------------------------------------------------------------
    // Status → MTI helpers
    // -------------------------------------------------------------------------

    static extractConsumerEventStatusMti(node, index) {
        switch (node.consumers.list[index].status) {
            case EVENT_STATUS.SET:   return MTI_CONSUMER_IDENTIFIED_SET;
            case EVENT_STATUS.CLEAR: return MTI_CONSUMER_IDENTIFIED_CLEAR;
            default:                 return MTI_CONSUMER_IDENTIFIED_UNKNOWN;
        }
    }

    static extractProducerEventStatusMti(node, index) {
        switch (node.producers.list[index].status) {
            case EVENT_STATUS.SET:   return MTI_PRODUCER_IDENTIFIED_SET;
            case EVENT_STATUS.CLEAR: return MTI_PRODUCER_IDENTIFIED_CLEAR;
            default:                 return MTI_PRODUCER_IDENTIFIED_UNKNOWN;
        }
    }

    // -------------------------------------------------------------------------
    // Internal: consumed-event cross-dispatch
    // -------------------------------------------------------------------------

    _testForConsumedEvent(sm, status, payload) {
        const cb = this._cb.onConsumedEventIdentified;
        if (!cb) return;
        const targetEventId = extractEventIdFromPayload(sm.incoming.msg);

        if (isEventIdInConsumerRanges(sm.node, targetEventId)) {
            cb(sm.node, -1, targetEventId, status, payload);
            return;
        }
        const idx = findConsumerEventIndex(sm.node, targetEventId);
        if (idx >= 0) cb(sm.node, idx, targetEventId, status, payload);
    }

    _testForConsumedEventPcer(sm, payload) {
        const cb = this._cb.onConsumedEventPcer;
        if (!cb) return;
        const targetEventId = extractEventIdFromPayload(sm.incoming.msg);

        if (isEventIdInConsumerRanges(sm.node, targetEventId)) {
            cb(sm.node, -1, targetEventId, payload);
            return;
        }
        const idx = findConsumerEventIndex(sm.node, targetEventId);
        if (idx >= 0) cb(sm.node, idx, targetEventId, payload);
    }

    // -------------------------------------------------------------------------
    // Enumerators — produce one message per call, set `enumerate` until done
    // -------------------------------------------------------------------------

    /** @returns {boolean} true while more producer-enum work remains */
    _identifyProducers(sm) {
        const node = sm.node;

        // Consumer enumeration already in progress — producer step is done.
        if (node.consumers.enumerator.running) return false;

        if (!node.producers.enumerator.running) {
            sm.incoming.enumerate = true;
            node.producers.enumerator.running = true;
            node.producers.enumerator.enumIndex = 0;
            node.producers.enumerator.rangeEnumIndex = 0;
        }

        // Ranges first.
        if (node.producers.enumerator.rangeEnumIndex < node.producers.rangeCount) {
            const r = node.producers.rangeList[node.producers.enumerator.rangeEnumIndex];
            loadOpenlcbMessage(
                sm.outgoing.msg,
                node.alias, node.id,
                sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
                MTI_PRODUCER_RANGE_IDENTIFIED
            );
            copyEventIdToPayload(sm.outgoing.msg, generateEventRangeId(r.startBase, r.eventCount));
            node.producers.enumerator.rangeEnumIndex++;
            sm.outgoing.enumerate = true;
            sm.outgoing.valid = true;
            return true;
        }

        if (node.producers.enumerator.enumIndex < node.producers.count) {
            const idx = node.producers.enumerator.enumIndex;
            loadOpenlcbMessage(
                sm.outgoing.msg,
                node.alias, node.id,
                sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
                ProtocolEventTransport.extractProducerEventStatusMti(node, idx)
            );
            copyEventIdToPayload(sm.outgoing.msg, node.producers.list[idx].event);
            node.producers.enumerator.enumIndex++;
            sm.outgoing.enumerate = true;
            sm.outgoing.valid = true;
            return true;
        }

        // Producers exhausted — arm consumer pass on next call.
        node.consumers.enumerator.enumIndex = 0;
        node.consumers.enumerator.rangeEnumIndex = 0;
        node.consumers.enumerator.running = false;
        sm.outgoing.enumerate = true;
        sm.outgoing.valid = false;
        return false;
    }

    /** @returns {boolean} true while more consumer-enum work remains */
    _identifyConsumers(sm) {
        const node = sm.node;

        if (!node.consumers.enumerator.running) {
            sm.incoming.enumerate = true;
            node.consumers.enumerator.running = true;
            node.consumers.enumerator.enumIndex = 0;
            node.consumers.enumerator.rangeEnumIndex = 0;
        }

        if (node.consumers.enumerator.rangeEnumIndex < node.consumers.rangeCount) {
            const r = node.consumers.rangeList[node.consumers.enumerator.rangeEnumIndex];
            loadOpenlcbMessage(
                sm.outgoing.msg,
                node.alias, node.id,
                sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
                MTI_CONSUMER_RANGE_IDENTIFIED
            );
            copyEventIdToPayload(sm.outgoing.msg, generateEventRangeId(r.startBase, r.eventCount));
            node.consumers.enumerator.rangeEnumIndex++;
            sm.outgoing.enumerate = true;
            sm.outgoing.valid = true;
            return true;
        }

        if (node.consumers.enumerator.enumIndex < node.consumers.count) {
            const idx = node.consumers.enumerator.enumIndex;
            loadOpenlcbMessage(
                sm.outgoing.msg,
                node.alias, node.id,
                sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
                ProtocolEventTransport.extractConsumerEventStatusMti(node, idx)
            );
            copyEventIdToPayload(sm.outgoing.msg, node.consumers.list[idx].event);
            node.consumers.enumerator.enumIndex++;
            sm.outgoing.enumerate = true;
            sm.outgoing.valid = true;
            return true;
        }

        // Everything emitted — clean up and signal the caller to stop.
        node.producers.enumerator.enumIndex = 0;
        node.producers.enumerator.rangeEnumIndex = 0;
        node.producers.enumerator.running = false;
        node.consumers.enumerator.enumIndex = 0;
        node.consumers.enumerator.rangeEnumIndex = 0;
        node.consumers.enumerator.running = false;
        sm.incoming.enumerate = false;
        sm.outgoing.valid = false;
        return false;
    }

    // -------------------------------------------------------------------------
    // Identify single producer/consumer — targeted request
    // -------------------------------------------------------------------------

    handleConsumerIdentify(sm) {
        const targetEventId = extractEventIdFromPayload(sm.incoming.msg);
        const idx = findConsumerEventIndex(sm.node, targetEventId);

        if (idx >= 0) {
            loadOpenlcbMessage(
                sm.outgoing.msg,
                sm.node.alias, sm.node.id,
                sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
                ProtocolEventTransport.extractConsumerEventStatusMti(sm.node, idx)
            );
            copyEventIdToPayload(sm.outgoing.msg, sm.node.consumers.list[idx].event);
            sm.outgoing.valid = true;
        } else if (isEventIdInConsumerRanges(sm.node, targetEventId)) {
            loadOpenlcbMessage(
                sm.outgoing.msg,
                sm.node.alias, sm.node.id,
                sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
                MTI_CONSUMER_IDENTIFIED_UNKNOWN
            );
            copyEventIdToPayload(sm.outgoing.msg, targetEventId);
            sm.outgoing.valid = true;
        } else {
            sm.outgoing.valid = false;
        }
    }

    handleProducerIdentify(sm) {
        const targetEventId = extractEventIdFromPayload(sm.incoming.msg);
        const idx = findProducerEventIndex(sm.node, targetEventId);

        if (idx >= 0) {
            loadOpenlcbMessage(
                sm.outgoing.msg,
                sm.node.alias, sm.node.id,
                sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
                ProtocolEventTransport.extractProducerEventStatusMti(sm.node, idx)
            );
            copyEventIdToPayload(sm.outgoing.msg, sm.node.producers.list[idx].event);
            sm.outgoing.valid = true;
        } else if (isEventIdInProducerRanges(sm.node, targetEventId)) {
            loadOpenlcbMessage(
                sm.outgoing.msg,
                sm.node.alias, sm.node.id,
                sm.incoming.msg.sourceAlias, sm.incoming.msg.sourceId,
                MTI_PRODUCER_IDENTIFIED_UNKNOWN
            );
            copyEventIdToPayload(sm.outgoing.msg, targetEventId);
            sm.outgoing.valid = true;
        } else {
            sm.outgoing.valid = false;
        }
    }

    // -------------------------------------------------------------------------
    // Range Identified — callback only, no automatic response
    // -------------------------------------------------------------------------

    handleConsumerRangeIdentified(sm) {
        this._fire('onConsumerRangeIdentified', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handleProducerRangeIdentified(sm) {
        this._fire('onProducerRangeIdentified', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    // -------------------------------------------------------------------------
    // Consumer Identified variants
    // -------------------------------------------------------------------------

    handleConsumerIdentifiedUnknown(sm) {
        this._fire('onConsumerIdentifiedUnknown', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handleConsumerIdentifiedSet(sm) {
        this._fire('onConsumerIdentifiedSet', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handleConsumerIdentifiedClear(sm) {
        this._fire('onConsumerIdentifiedClear', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handleConsumerIdentifiedReserved(sm) {
        this._fire('onConsumerIdentifiedReserved', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    // -------------------------------------------------------------------------
    // Producer Identified variants — also cross-dispatch as consumed events
    // -------------------------------------------------------------------------

    handleProducerIdentifiedUnknown(sm) {
        this._testForConsumedEvent(sm, EVENT_STATUS.UNKNOWN, null);
        this._fire('onProducerIdentifiedUnknown', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handleProducerIdentifiedSet(sm) {
        this._testForConsumedEvent(sm, EVENT_STATUS.SET, null);
        this._fire('onProducerIdentifiedSet', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handleProducerIdentifiedClear(sm) {
        this._testForConsumedEvent(sm, EVENT_STATUS.CLEAR, null);
        this._fire('onProducerIdentifiedClear', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handleProducerIdentifiedReserved(sm) {
        this._fire('onProducerIdentifiedReserved', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    // -------------------------------------------------------------------------
    // Events Identify (global + addressed)
    // -------------------------------------------------------------------------

    handleEventsIdentify(sm) {
        if (this._identifyProducers(sm)) return;
        this._identifyConsumers(sm);
    }

    handleEventsIdentifyDest(sm) {
        // The C port checks addressedness; our MTI dispatcher already does
        // that before invoking this handler, but keep the guard for callers
        // that invoke the handler directly.
        if (sm.node.alias === sm.incoming.msg.destAlias || sm.node.id === sm.incoming.msg.destId) {
            this.handleEventsIdentify(sm);
            return;
        }
        sm.outgoing.valid = false;
    }

    // -------------------------------------------------------------------------
    // Event Learn / PCER / PCER-with-payload
    // -------------------------------------------------------------------------

    handleEventLearn(sm) {
        this._fire('onEventLearn', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handlePcEventReport(sm) {
        this._testForConsumedEventPcer(sm, null);
        this._fire('onPcEventReport', sm.node, extractEventIdFromPayload(sm.incoming.msg));
        sm.outgoing.valid = false;
    }

    handlePcEventReportWithPayload(sm) {
        const msg = sm.incoming.msg;
        if (msg.payloadCount <= LEN_EVENT_ID) {
            sm.outgoing.valid = false;
            return;
        }
        const eventId = extractEventIdFromPayload(msg);
        const payloadCount = msg.payloadCount - LEN_EVENT_ID;
        const payload = msg.payload.subarray(LEN_EVENT_ID, LEN_EVENT_ID + payloadCount);

        this._testForConsumedEventPcer(sm, payload);
        this._fire('onPcEventReportWithPayload', sm.node, eventId, payloadCount, payload);
        sm.outgoing.valid = false;
    }
}

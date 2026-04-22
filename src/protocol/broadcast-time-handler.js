// Ported from OpenLcbCLib/src/openlcb/protocol_broadcast_time_handler.[hc].
//
// Broadcast Time Protocol — decodes incoming well-known broadcast-time
// events into time/date/year/rate/command updates for the registered clock.
// Also provides the utility encoders/decoders used by the application to
// build outbound broadcast-time events.
//
// Unlike most handlers, broadcast-time only processes events on node index 0
// (broadcast time is a global notion). The `deps.getClock(clockId)` callback
// returns the clock state object the application uses for its clocks —
// typically the same instances the app's broadcast-time application layer
// manages.

import {
    BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK,
    BROADCAST_TIME_ID_DEFAULT_REALTIME_CLOCK,
    BROADCAST_TIME_ID_ALTERNATE_CLOCK_1,
    BROADCAST_TIME_ID_ALTERNATE_CLOCK_2,
    BROADCAST_TIME_MASK_CLOCK_ID,
    BROADCAST_TIME_MASK_COMMAND_DATA,
    BROADCAST_TIME_QUERY,
    BROADCAST_TIME_STOP,
    BROADCAST_TIME_START,
    BROADCAST_TIME_DATE_ROLLOVER,
    BROADCAST_TIME_SET_COMMAND_OFFSET,
    BROADCAST_TIME_SET_TIME_BASE,
    BROADCAST_TIME_SET_DATE_BASE,
    BROADCAST_TIME_SET_YEAR_BASE,
    BROADCAST_TIME_SET_RATE_BASE,
    BROADCAST_TIME_REPORT_DATE_BASE,
    BROADCAST_TIME_REPORT_YEAR_BASE,
    BROADCAST_TIME_REPORT_RATE_BASE,
} from '../openlcb/defines.js';
import { BROADCAST_TIME_EVENT_TYPE } from '../openlcb/types.js';

// =============================================================================
// Event-ID utilities (exported — tests can use these without instantiating)
// =============================================================================

const KNOWN_CLOCK_IDS = new Set([
    BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK,
    BROADCAST_TIME_ID_DEFAULT_REALTIME_CLOCK,
    BROADCAST_TIME_ID_ALTERNATE_CLOCK_1,
    BROADCAST_TIME_ID_ALTERNATE_CLOCK_2,
]);

/** Known well-known clock IDs — the application may register custom clocks in addition. */
export function isWellKnownClock(clockId) {
    return KNOWN_CLOCK_IDS.has(clockId);
}

export function extractClockId(eventId) {
    return eventId & BROADCAST_TIME_MASK_CLOCK_ID;
}

function commandData(eventId) {
    return Number(eventId & BROADCAST_TIME_MASK_COMMAND_DATA) & 0xFFFF;
}

export function getEventType(eventId) {
    const cd = commandData(eventId);
    if (cd === BROADCAST_TIME_QUERY)         return BROADCAST_TIME_EVENT_TYPE.QUERY;
    if (cd === BROADCAST_TIME_STOP)          return BROADCAST_TIME_EVENT_TYPE.STOP;
    if (cd === BROADCAST_TIME_START)         return BROADCAST_TIME_EVENT_TYPE.START;
    if (cd === BROADCAST_TIME_DATE_ROLLOVER) return BROADCAST_TIME_EVENT_TYPE.DATE_ROLLOVER;

    if (cd >= BROADCAST_TIME_SET_RATE_BASE && cd <= 0xCFFF)    return BROADCAST_TIME_EVENT_TYPE.SET_RATE;
    if (cd >= BROADCAST_TIME_SET_YEAR_BASE && cd <= 0xBFFF)    return BROADCAST_TIME_EVENT_TYPE.SET_YEAR;
    if (cd >= BROADCAST_TIME_SET_DATE_BASE && cd <= 0xACFF)    return BROADCAST_TIME_EVENT_TYPE.SET_DATE;
    if (cd >= BROADCAST_TIME_SET_TIME_BASE && cd <= 0x97FF)    return BROADCAST_TIME_EVENT_TYPE.SET_TIME;

    if (cd >= BROADCAST_TIME_REPORT_RATE_BASE && cd <= 0x4FFF) return BROADCAST_TIME_EVENT_TYPE.REPORT_RATE;
    if (cd >= BROADCAST_TIME_REPORT_YEAR_BASE && cd <= 0x3FFF) return BROADCAST_TIME_EVENT_TYPE.REPORT_YEAR;
    if (cd >= BROADCAST_TIME_REPORT_DATE_BASE && cd <= 0x2CFF) return BROADCAST_TIME_EVENT_TYPE.REPORT_DATE;
    if (cd <= 0x17FF)                                         return BROADCAST_TIME_EVENT_TYPE.REPORT_TIME;
    return BROADCAST_TIME_EVENT_TYPE.UNKNOWN;
}

function stripSetOffset(cd) {
    return cd >= BROADCAST_TIME_SET_COMMAND_OFFSET ? cd - BROADCAST_TIME_SET_COMMAND_OFFSET : cd;
}

export function extractTime(eventId) {
    const cd = stripSetOffset(commandData(eventId));
    const hour = (cd >>> 8) & 0xFF;
    const minute = cd & 0xFF;
    if (hour >= 24 || minute >= 60) return null;
    return { hour, minute };
}

export function extractDate(eventId) {
    const cd = stripSetOffset(commandData(eventId));
    const month = ((cd >>> 8) & 0xFF) - 0x20;
    const day = cd & 0xFF;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month, day };
}

export function extractYear(eventId) {
    const cd = stripSetOffset(commandData(eventId));
    const y = cd - BROADCAST_TIME_REPORT_YEAR_BASE;
    if (y < 0 || y > 4095) return null;
    return y;
}

export function extractRate(eventId) {
    const cd = stripSetOffset(commandData(eventId));
    const raw = (cd - BROADCAST_TIME_REPORT_RATE_BASE) & 0x0FFF;
    // 12-bit signed — sign-extend bit 11.
    return raw & 0x0800 ? (raw | 0xFFFFF000) | 0 : raw;
}

// -----------------------------------------------------------------------------
// Encoders
// -----------------------------------------------------------------------------

export function createTimeEventId(clockId, hour, minute, isSet) {
    let cd = ((hour & 0xFF) << 8) | (minute & 0xFF);
    if (isSet) cd += BROADCAST_TIME_SET_COMMAND_OFFSET;
    return (clockId & BROADCAST_TIME_MASK_CLOCK_ID) | BigInt(cd);
}

export function createDateEventId(clockId, month, day, isSet) {
    let cd = (((0x20 + month) & 0xFF) << 8) | (day & 0xFF);
    if (isSet) cd += BROADCAST_TIME_SET_COMMAND_OFFSET;
    return (clockId & BROADCAST_TIME_MASK_CLOCK_ID) | BigInt(cd);
}

export function createYearEventId(clockId, year, isSet) {
    let cd = BROADCAST_TIME_REPORT_YEAR_BASE + (year & 0xFFFF);
    if (isSet) cd += BROADCAST_TIME_SET_COMMAND_OFFSET;
    return (clockId & BROADCAST_TIME_MASK_CLOCK_ID) | BigInt(cd);
}

export function createRateEventId(clockId, rate, isSet) {
    let cd = BROADCAST_TIME_REPORT_RATE_BASE + (rate & 0x0FFF);
    if (isSet) cd += BROADCAST_TIME_SET_COMMAND_OFFSET;
    return (clockId & BROADCAST_TIME_MASK_CLOCK_ID) | BigInt(cd);
}

export function createCommandEventId(clockId, command) {
    let cd = 0;
    switch (command) {
        case BROADCAST_TIME_EVENT_TYPE.QUERY:         cd = BROADCAST_TIME_QUERY; break;
        case BROADCAST_TIME_EVENT_TYPE.STOP:          cd = BROADCAST_TIME_STOP; break;
        case BROADCAST_TIME_EVENT_TYPE.START:         cd = BROADCAST_TIME_START; break;
        case BROADCAST_TIME_EVENT_TYPE.DATE_ROLLOVER: cd = BROADCAST_TIME_DATE_ROLLOVER; break;
    }
    return (clockId & BROADCAST_TIME_MASK_CLOCK_ID) | BigInt(cd);
}

// =============================================================================
// Handler class
// =============================================================================

export class ProtocolBroadcastTimeHandler {
    /**
     * @param {Object} deps
     * @param {(clockId: bigint) => Object|null} deps.getClock
     *        Returns the clock-state object (with .time/.date/.year/.rate/.isRunning)
     *        for the given 48-bit clock ID, or null if not registered.
     * @param {(clockId) => boolean} [deps.isProducer]
     *        Returns true if this node produces time events for the given clock.
     * @param {Object} [deps.callbacks] Notifier callbacks:
     *        onTimeReceived, onDateReceived, onYearReceived, onRateReceived,
     *        onClockStarted, onClockStopped, onDateRollover.
     * @param {(node, clockId, hour, minute) => void} [deps.sendReportTime]
     *        Emit a Report Time PCER (typically via the app layer).
     * @param {(clockId) => void} [deps.triggerSyncDelay]
     *        Start the 3-second coalescing timer for Set commands.
     * @param {(clockId) => void} [deps.triggerQueryReply]
     *        Run the full query-reply sequence for this producer clock.
     */
    constructor(deps = {}) {
        this._d = deps;
        this._cb = deps.callbacks ?? {};
    }

    /** True iff the event is a broadcast-time event for any known or registered clock. */
    isTimeEvent(eventId) {
        const clockId = extractClockId(eventId);
        if (isWellKnownClock(clockId)) return true;
        return this._d.getClock ? this._d.getClock(clockId) !== null : false;
    }

    /** Handle one broadcast-time event on node index 0. */
    handleTimeEvent(sm, eventId) {
        if (!sm?.node || sm.node.index !== 0) return;

        const clockId = extractClockId(eventId);
        const clock = this._d.getClock ? this._d.getClock(clockId) : null;
        if (!clock) return;

        const type = getEventType(eventId);
        switch (type) {
            case BROADCAST_TIME_EVENT_TYPE.REPORT_TIME:
                this._applyTime(sm.node, clock, eventId);
                break;

            case BROADCAST_TIME_EVENT_TYPE.REPORT_DATE:
                this._applyDate(sm.node, clock, eventId);
                break;

            case BROADCAST_TIME_EVENT_TYPE.REPORT_YEAR:
                this._applyYear(sm.node, clock, eventId);
                break;

            case BROADCAST_TIME_EVENT_TYPE.REPORT_RATE:
                this._applyRate(sm.node, clock, eventId);
                break;

            case BROADCAST_TIME_EVENT_TYPE.SET_TIME:
                if (this._d.isProducer?.(clockId)) {
                    this._applyTime(sm.node, clock, eventId);
                    this._d.sendReportTime?.(sm.node, clockId, clock.time.hour, clock.time.minute);
                    this._d.triggerSyncDelay?.(clockId);
                }
                break;

            case BROADCAST_TIME_EVENT_TYPE.SET_DATE:
                if (this._d.isProducer?.(clockId)) {
                    this._applyDate(sm.node, clock, eventId);
                    this._d.triggerSyncDelay?.(clockId);
                }
                break;

            case BROADCAST_TIME_EVENT_TYPE.SET_YEAR:
                if (this._d.isProducer?.(clockId)) {
                    this._applyYear(sm.node, clock, eventId);
                    this._d.triggerSyncDelay?.(clockId);
                }
                break;

            case BROADCAST_TIME_EVENT_TYPE.SET_RATE:
                if (this._d.isProducer?.(clockId)) {
                    this._applyRate(sm.node, clock, eventId);
                    this._d.triggerSyncDelay?.(clockId);
                }
                break;

            case BROADCAST_TIME_EVENT_TYPE.START:
                clock.isRunning = true;
                clock.msAccumulator = 0;
                this._cb.onClockStarted?.(sm.node, clock);
                if (this._d.isProducer?.(clockId)) this._d.triggerSyncDelay?.(clockId);
                break;

            case BROADCAST_TIME_EVENT_TYPE.STOP:
                clock.isRunning = false;
                this._cb.onClockStopped?.(sm.node, clock);
                if (this._d.isProducer?.(clockId)) this._d.triggerSyncDelay?.(clockId);
                break;

            case BROADCAST_TIME_EVENT_TYPE.DATE_ROLLOVER:
                this._cb.onDateRollover?.(sm.node, clock);
                break;

            case BROADCAST_TIME_EVENT_TYPE.QUERY:
                if (this._d.isProducer?.(clockId)) this._d.triggerQueryReply?.(clockId);
                break;

            default:
                break;
        }
    }

    // -------------------------------------------------------------------------
    // Apply helpers
    // -------------------------------------------------------------------------

    _applyTime(node, clock, eventId) {
        const hm = extractTime(eventId);
        if (!hm) return;
        clock.time.hour = hm.hour;
        clock.time.minute = hm.minute;
        clock.time.valid = true;
        clock.msAccumulator = 0;
        this._cb.onTimeReceived?.(node, clock);
    }

    _applyDate(node, clock, eventId) {
        const md = extractDate(eventId);
        if (!md) return;
        clock.date.month = md.month;
        clock.date.day = md.day;
        clock.date.valid = true;
        this._cb.onDateReceived?.(node, clock);
    }

    _applyYear(node, clock, eventId) {
        const y = extractYear(eventId);
        if (y === null) return;
        clock.year.year = y;
        clock.year.valid = true;
        this._cb.onYearReceived?.(node, clock);
    }

    _applyRate(node, clock, eventId) {
        const r = extractRate(eventId);
        if (r === null) return;
        clock.rate.rate = r;
        clock.rate.valid = true;
        clock.msAccumulator = 0;
        this._cb.onRateReceived?.(node, clock);
    }
}

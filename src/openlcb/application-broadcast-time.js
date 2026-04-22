// Ported from OpenLcbCLib/src/openlcb/openlcb_application_broadcast_time.[hc].
//
// Application-side Broadcast Time Protocol — clock slot allocation, consumer
// clock advancement via the 100ms tick (fixed-point fractional rates), and
// throttle-side send helpers (Report/Set time/date/year/rate, Start/Stop,
// Date Rollover, Query, query-reply sync sequence).
//
// Encoders/decoders live in the protocol-layer broadcast-time handler and
// are imported here so this module can stay focused on clock-slot lifecycle.

import {
    MTI_PC_EVENT_REPORT,
    MTI_PRODUCER_IDENTIFIED_SET,
    BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK,
    BROADCAST_TIME_ID_DEFAULT_REALTIME_CLOCK,
    BROADCAST_TIME_ID_ALTERNATE_CLOCK_1,
    BROADCAST_TIME_ID_ALTERNATE_CLOCK_2,
    BROADCAST_TIME_MASK_CLOCK_ID,
    RUNSTATE_RUN,
} from './defines.js';
import { PAYLOAD_TYPE, createMessage, BROADCAST_TIME_EVENT_TYPE, EVENT_RANGE_COUNT } from './types.js';
import {
    loadOpenlcbMessage,
    copyEventIdToPayload,
} from './utilities.js';
import {
    createTimeEventId,
    createDateEventId,
    createYearEventId,
    createRateEventId,
    createCommandEventId,
} from '../protocol/broadcast-time-handler.js';

const WELL_KNOWN_CLOCKS = [
    BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK,
    BROADCAST_TIME_ID_DEFAULT_REALTIME_CLOCK,
    BROADCAST_TIME_ID_ALTERNATE_CLOCK_1,
    BROADCAST_TIME_ID_ALTERNATE_CLOCK_2,
];

/** Sync-delay countdown in 100ms ticks (3 seconds). */
const SYNC_DELAY_TICKS = 30;

/** Periodic report-time cooldown in 100ms ticks (60 seconds). */
const REPORT_COOLDOWN_TICKS = 600;

function createClock(clockId) {
    return {
        state: {
            clockId,
            time: { hour: 0, minute: 0, valid: false },
            date: { month: 1, day: 1, valid: false },
            year: { year: 2024, valid: false },
            rate: { rate: 0, valid: false },
            isRunning: false,
            msAccumulator: 0,
        },
        isConsumer: false,
        isProducer: false,
        isAllocated: true,
        queryReplyPending: false,
        syncPending: false,
        sendQueryReplyState: 0,
        syncDelayTicks: 0,
        reportCooldownTicks: 0,
        previousRunState: 0,
        producerNode: null,
    };
}

export class OpenLcbApplicationBroadcastTime {
    /**
     * @param {Object} deps
     * @param {OpenLcbApplication} deps.application required — event range registration
     * @param {(msg) => boolean}   deps.sendOpenlcbMsg required
     * @param {Object}             [deps.callbacks]
     * @param {number}             [deps.maxCustomClocks=4]
     */
    constructor(deps) {
        this._application = deps.application;
        this._sendOpenlcbMsg = deps.sendOpenlcbMsg;
        this._cb = deps.callbacks ?? {};
        /** @type {Map<bigint, Object>} clockId → clock */
        this._clocks = new Map();
        this._maxCustomClocks = deps.maxCustomClocks ?? 4;
        this._lastTick = 0;
    }

    // -------------------------------------------------------------------------
    // Slot allocation
    // -------------------------------------------------------------------------

    /** Allocate or return existing clock slot, marking as consumer, registering event ranges. */
    setupConsumer(node, clockId) {
        const clock = this._getOrCreate(clockId);
        if (!clock) return null;
        clock.isConsumer = true;
        if (node) this._registerRanges(node, clockId);
        return clock.state;
    }

    /** Same, producer side — also records the producer node for self-originated events. */
    setupProducer(node, clockId) {
        const clock = this._getOrCreate(clockId);
        if (!clock) return null;
        clock.isProducer = true;
        clock.producerNode = node;
        if (node) this._registerRanges(node, clockId);
        return clock.state;
    }

    _getOrCreate(clockId) {
        const masked = clockId & BROADCAST_TIME_MASK_CLOCK_ID;
        let clock = this._clocks.get(masked);
        if (clock) return clock;

        // Allow all well-known clocks; cap custom allocations at maxCustomClocks.
        const isWellKnown = WELL_KNOWN_CLOCKS.includes(masked);
        if (!isWellKnown) {
            let customCount = 0;
            for (const [id] of this._clocks) {
                if (!WELL_KNOWN_CLOCKS.includes(id)) customCount++;
            }
            if (customCount >= this._maxCustomClocks) return null;
        }

        clock = createClock(masked);
        this._clocks.set(masked, clock);
        return clock;
    }

    _registerRanges(node, clockId) {
        const masked = clockId & BROADCAST_TIME_MASK_CLOCK_ID;
        // Full 65536-event span per clock — two 32768 ranges ( | 0x0000 and
        // | 0x8000 ) so Report suffixes (low half) and Set/command suffixes
        // (high half, including 0xF001 Stop / 0xF002 Start / 0xF003 Rollover)
        // are both covered. Mirrors OpenLcbCLib/src/openlcb/
        // openlcb_application_broadcast_time.c:205-211.
        this._application.registerConsumerRange(node, masked | 0x0000n, EVENT_RANGE_COUNT.C_32768);
        this._application.registerConsumerRange(node, masked | 0x8000n, EVENT_RANGE_COUNT.C_32768);
        this._application.registerProducerRange(node, masked | 0x0000n, EVENT_RANGE_COUNT.C_32768);
        this._application.registerProducerRange(node, masked | 0x8000n, EVENT_RANGE_COUNT.C_32768);
    }

    getClock(clockId) {
        const clock = this._clocks.get(clockId & BROADCAST_TIME_MASK_CLOCK_ID);
        return clock ? clock.state : null;
    }

    isConsumer(clockId) {
        const clock = this._clocks.get(clockId & BROADCAST_TIME_MASK_CLOCK_ID);
        return !!(clock && clock.isConsumer);
    }

    isProducer(clockId) {
        const clock = this._clocks.get(clockId & BROADCAST_TIME_MASK_CLOCK_ID);
        return !!(clock && clock.isProducer);
    }

    start(clockId) {
        const clock = this._clocks.get(clockId & BROADCAST_TIME_MASK_CLOCK_ID);
        if (clock) { clock.state.isRunning = true; clock.state.msAccumulator = 0; }
    }

    stop(clockId) {
        const clock = this._clocks.get(clockId & BROADCAST_TIME_MASK_CLOCK_ID);
        if (clock) clock.state.isRunning = false;
    }

    /** Compose a clock ID from a 48-bit unique identifier (Node ID etc.). */
    static makeClockId(uniqueId48) {
        return (BigInt.asUintN(48, uniqueId48) << 16n);
    }

    triggerQueryReply(clockId) {
        const clock = this._clocks.get(clockId & BROADCAST_TIME_MASK_CLOCK_ID);
        if (clock && clock.isProducer) {
            clock.queryReplyPending = true;
            clock.sendQueryReplyState = 0;
        }
    }

    triggerSyncDelay(clockId) {
        const clock = this._clocks.get(clockId & BROADCAST_TIME_MASK_CLOCK_ID);
        if (clock && clock.isProducer) {
            clock.syncPending = true;
            clock.syncDelayTicks = SYNC_DELAY_TICKS;
        }
    }

    // -------------------------------------------------------------------------
    // 100ms tick — advance running consumer clocks, drive sync/query reply
    // -------------------------------------------------------------------------

    timerTick(currentTick) {
        const ticksElapsed = (currentTick - this._lastTick) & 0xFF;
        if (ticksElapsed === 0) return;
        this._lastTick = currentTick & 0xFF;

        for (const clock of this._clocks.values()) {
            if (clock.isConsumer) this._advanceConsumer(clock, ticksElapsed);

            if (clock.isProducer) {
                this._advanceProducer(clock, ticksElapsed);

                if (clock.syncPending && clock.syncDelayTicks > 0) {
                    clock.syncDelayTicks = Math.max(0, clock.syncDelayTicks - ticksElapsed);
                    if (clock.syncDelayTicks === 0) {
                        clock.syncPending = false;
                        clock.queryReplyPending = true;
                        clock.sendQueryReplyState = 0;
                    }
                }
                if (clock.queryReplyPending && clock.producerNode) {
                    this._driveQueryReply(clock);
                }

                // Post-login auto-trigger of startup sync burst (Standard §6.1).
                const node = clock.producerNode;
                if (node) {
                    const curRunState = node.state.runState;
                    if (clock.previousRunState < RUNSTATE_RUN && curRunState >= RUNSTATE_RUN) {
                        clock.queryReplyPending = true;
                        clock.sendQueryReplyState = 0;
                    }
                    clock.previousRunState = curRunState;
                }
            }
        }
    }

    /**
     * Advance a producer clock. Same fast-minute accounting as the consumer
     * path, plus:
     *   - Periodic Report Time PCER every minute boundary, rate-limited to
     *     one emission per REPORT_COOLDOWN_TICKS (60 real seconds).
     *   - 23:59→00:00 rollover: emit Date Rollover + Report Year + Report Date.
     * Mirrors OpenLcbCLib openlcb_application_broadcast_time.c:680-770.
     */
    _advanceProducer(clock, ticksElapsed) {
        const s = clock.state;
        const node = clock.producerNode;

        // Cooldown counter ticks down whether or not we're running so the
        // first post-start emission isn't artificially delayed by a leftover
        // cooldown. (C ref decrements unconditionally.)
        if (clock.reportCooldownTicks > 0) {
            clock.reportCooldownTicks = Math.max(0, clock.reportCooldownTicks - ticksElapsed);
        }

        if (!s.isRunning || !s.rate.valid || s.rate.rate === 0) return;

        const delta = ticksElapsed * 100 * s.rate.rate;
        s.msAccumulator += delta;
        const oneMinute = 240_000;
        while (s.msAccumulator >= oneMinute) {
            s.msAccumulator -= oneMinute;
            const prevHour = s.time.hour;
            s.time.minute++;
            if (s.time.minute >= 60) {
                s.time.minute = 0;
                s.time.hour = (s.time.hour + 1) % 24;
                if (prevHour === 23 && s.time.hour === 0) {
                    // Advance date: simple Gregorian rollover.
                    this._advanceDate(s);
                    if (node) {
                        this.sendDateRollover(node, s.clockId);
                        this.sendReportYear(node, s.clockId, s.year.year);
                        this.sendReportDate(node, s.clockId, s.date.month, s.date.day);
                    }
                }
            }
            // Rate-limited periodic Report Time PCER.
            if (node && clock.reportCooldownTicks === 0) {
                this.sendReportTime(node, s.clockId, s.time.hour, s.time.minute);
                clock.reportCooldownTicks = REPORT_COOLDOWN_TICKS;
            }
            this._cb.onTimeChanged?.(clock);
        }
    }

    _advanceDate(s) {
        const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const y = s.year.year;
        const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
        const limit = (s.date.month === 2 && leap) ? 29 : daysInMonth[s.date.month - 1];
        s.date.day++;
        if (s.date.day > limit) {
            s.date.day = 1;
            s.date.month++;
            if (s.date.month > 12) {
                s.date.month = 1;
                s.year.year++;
            }
        }
    }

    /**
     * Advance a consumer clock's time by `ticksElapsed`. The rate is a 10.2
     * signed fixed-point value: rate/4 × real minutes per tick = fast minutes.
     * Fires `onTimeChanged` each time a minute boundary is crossed.
     */
    _advanceConsumer(clock, ticksElapsed) {
        const s = clock.state;
        if (!s.isRunning || !s.rate.valid || s.rate.rate === 0) return;

        // ticksElapsed × 100ms = elapsed real-time ms.
        // rate/4 = multiplier, so fast ms = real ms × rate/4.
        // Accumulate as integer ms; advance when crossing 60_000 (one minute).
        const delta = ticksElapsed * 100 * s.rate.rate;
        s.msAccumulator += delta;
        // One fast-minute is (60_000 * 4) = 240_000 in our scaled accumulator.
        const oneMinute = 240_000;
        while (s.msAccumulator >= oneMinute) {
            s.msAccumulator -= oneMinute;
            s.time.minute++;
            if (s.time.minute >= 60) {
                s.time.minute = 0;
                s.time.hour = (s.time.hour + 1) % 24;
                if (s.time.hour === 0) {
                    this._cb.onDateRollover?.(clock.producerNode, s);
                }
            }
            this._cb.onTimeChanged?.(clock);
        }
    }

    // 6-message sync sequence per the Broadcast Time Standard:
    //   0 → Start/Stop command
    //   1 → Rate as Producer Identified Set
    //   2 → Year as Producer Identified Set
    //   3 → Date as Producer Identified Set
    //   4 → current Time as Producer Identified Set
    //   5 → next-minute Time as PC Event Report
    _driveQueryReply(clock) {
        const s = clock.state;
        const node = clock.producerNode;
        const id = s.clockId;

        switch (clock.sendQueryReplyState) {
            case 0: {
                const eid = createCommandEventId(id,
                    s.isRunning ? BROADCAST_TIME_EVENT_TYPE.START : BROADCAST_TIME_EVENT_TYPE.STOP);
                if (this._sendEvent(node, eid, MTI_PRODUCER_IDENTIFIED_SET)) clock.sendQueryReplyState = 1;
                return;
            }
            case 1: {
                if (this._sendEvent(node, createRateEventId(id, s.rate.rate, false), MTI_PRODUCER_IDENTIFIED_SET)) clock.sendQueryReplyState = 2;
                return;
            }
            case 2: {
                if (this._sendEvent(node, createYearEventId(id, s.year.year, false), MTI_PRODUCER_IDENTIFIED_SET)) clock.sendQueryReplyState = 3;
                return;
            }
            case 3: {
                if (this._sendEvent(node, createDateEventId(id, s.date.month, s.date.day, false), MTI_PRODUCER_IDENTIFIED_SET)) clock.sendQueryReplyState = 4;
                return;
            }
            case 4: {
                if (this._sendEvent(node, createTimeEventId(id, s.time.hour, s.time.minute, false), MTI_PRODUCER_IDENTIFIED_SET)) clock.sendQueryReplyState = 5;
                return;
            }
            case 5: {
                // Next-minute time as PC Event Report.
                let h = s.time.hour, m = s.time.minute + 1;
                if (m >= 60) { m = 0; h = (h + 1) % 24; }
                if (this._sendEvent(node, createTimeEventId(id, h, m, false), MTI_PC_EVENT_REPORT)) {
                    clock.queryReplyPending = false;
                    clock.sendQueryReplyState = 0;
                }
                return;
            }
            default:
                clock.queryReplyPending = false;
                clock.sendQueryReplyState = 0;
        }
    }

    // -------------------------------------------------------------------------
    // Send helpers (all event-carrying messages)
    // -------------------------------------------------------------------------

    _sendEvent(node, eventId, mti) {
        const msg = createMessage({ payloadType: PAYLOAD_TYPE.BASIC });
        loadOpenlcbMessage(msg, node.alias, node.id, 0, 0n, mti);
        copyEventIdToPayload(msg, eventId);
        return this._sendOpenlcbMsg(msg);
    }

    _producerOrNoop(clockId) {
        const clock = this._clocks.get(clockId & BROADCAST_TIME_MASK_CLOCK_ID);
        return clock && clock.isProducer ? clock : null;
    }

    sendReportTime(node, clockId, hour, minute) {
        if (!this._producerOrNoop(clockId)) return true;
        return this._sendEvent(node, createTimeEventId(clockId, hour, minute, false), MTI_PC_EVENT_REPORT);
    }

    sendReportDate(node, clockId, month, day) {
        if (!this._producerOrNoop(clockId)) return true;
        return this._sendEvent(node, createDateEventId(clockId, month, day, false), MTI_PC_EVENT_REPORT);
    }

    sendReportYear(node, clockId, year) {
        if (!this._producerOrNoop(clockId)) return true;
        return this._sendEvent(node, createYearEventId(clockId, year, false), MTI_PC_EVENT_REPORT);
    }

    sendReportRate(node, clockId, rate) {
        if (!this._producerOrNoop(clockId)) return true;
        return this._sendEvent(node, createRateEventId(clockId, rate, false), MTI_PC_EVENT_REPORT);
    }

    sendStart(node, clockId) {
        if (!this._producerOrNoop(clockId)) return true;
        return this._sendEvent(node, createCommandEventId(clockId, BROADCAST_TIME_EVENT_TYPE.START), MTI_PC_EVENT_REPORT);
    }

    sendStop(node, clockId) {
        if (!this._producerOrNoop(clockId)) return true;
        return this._sendEvent(node, createCommandEventId(clockId, BROADCAST_TIME_EVENT_TYPE.STOP), MTI_PC_EVENT_REPORT);
    }

    sendDateRollover(node, clockId) {
        if (!this._producerOrNoop(clockId)) return true;
        return this._sendEvent(node, createCommandEventId(clockId, BROADCAST_TIME_EVENT_TYPE.DATE_ROLLOVER), MTI_PC_EVENT_REPORT);
    }

    // Consumer-side: ask a producer for its state.
    sendQuery(node, clockId) {
        return this._sendEvent(node, createCommandEventId(clockId, BROADCAST_TIME_EVENT_TYPE.QUERY), MTI_PC_EVENT_REPORT);
    }

    // Throttle-side Set commands.
    sendSetTime(node, clockId, hour, minute) {
        return this._sendEvent(node, createTimeEventId(clockId, hour, minute, true), MTI_PC_EVENT_REPORT);
    }

    sendSetDate(node, clockId, month, day) {
        return this._sendEvent(node, createDateEventId(clockId, month, day, true), MTI_PC_EVENT_REPORT);
    }

    sendSetYear(node, clockId, year) {
        return this._sendEvent(node, createYearEventId(clockId, year, true), MTI_PC_EVENT_REPORT);
    }

    sendSetRate(node, clockId, rate) {
        return this._sendEvent(node, createRateEventId(clockId, rate, true), MTI_PC_EVENT_REPORT);
    }

    sendCommandStart(node, clockId) {
        return this._sendEvent(node, createCommandEventId(clockId, BROADCAST_TIME_EVENT_TYPE.START), MTI_PC_EVENT_REPORT);
    }

    sendCommandStop(node, clockId) {
        return this._sendEvent(node, createCommandEventId(clockId, BROADCAST_TIME_EVENT_TYPE.STOP), MTI_PC_EVENT_REPORT);
    }
}

// Replaces OpenLcbCLib/src/drivers/canbus/can_buffer_fifo.[hc].
//
// The C version is a fixed-capacity ring buffer because CAN messages live in
// a static pool. JS has GC, so Array.push / Array.shift works. API mirrors
// can_buffer_fifo.h for the benefit of downstream code reading like the port.

export class CanBufferFifo {
    constructor() {
        this._queue = [];
    }

    initialize() {
        this._queue.length = 0;
    }

    /** Push to the tail. Always succeeds (no capacity in the JS port). Returns true. */
    push(canMsg) {
        this._queue.push(canMsg);
        return true;
    }

    /** Pop from the head. Returns the oldest frame, or null if empty. */
    pop() {
        if (this._queue.length === 0) return null;
        return this._queue.shift();
    }

    isEmpty() {
        return this._queue.length === 0;
    }

    getAllocatedCount() {
        return this._queue.length;
    }
}

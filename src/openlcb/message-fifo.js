// Replaces OpenLcbCLib/src/openlcb/openlcb_buffer_fifo.[hc].
//
// In C the FIFO uses a fixed-capacity ring buffer because messages live in
// static buffer pools. In JS messages are plain objects that the GC reclaims
// once nothing references them, so Array.push / Array.shift is adequate — no
// pool, no capacity, no head/tail arithmetic. The API surface is preserved so
// downstream modules read the same way as the C port.

export class MessageFifo {
    constructor() {
        this._queue = [];
    }

    /** Reset the queue to empty. */
    initialize() {
        this._queue.length = 0;
    }

    /**
     * Append a message to the tail. Returns the queued message (never null —
     * the JS port has no fixed capacity).
     * @param {Object} msg
     */
    push(msg) {
        this._queue.push(msg);
        return msg;
    }

    /**
     * Remove and return the oldest message, or null if the queue is empty.
     * @returns {Object|null}
     */
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

    /**
     * Mark every queued message whose sourceAlias matches `alias` as invalid.
     * Called when an AMR retires an alias so stale incoming messages don't
     * generate replies to a gone-away node. Matches the C semantics: the
     * messages stay in the FIFO; the pop-phase / TX guard discards them.
     *
     * @param {number} alias 12-bit CAN alias. If 0, does nothing.
     */
    checkAndInvalidateMessagesBySourceAlias(alias) {
        if (alias === 0) return;
        for (const msg of this._queue) {
            if (msg.sourceAlias === alias) {
                msg.state.invalid = true;
            }
        }
    }
}

/**
 * The event path, and its bounds (REQ-006).
 *
 * Two different things travel from the addon to the renderer, and they need
 * opposite failure behaviour:
 *
 * - **Pushed events** — a MIDI message off a driver thread, dictation text, an
 *   analysis progress tick, a plugin latency change. These are fire and forget:
 *   the addon's `EventSink` discards the result, and a listener that has gone
 *   away has never been a reason to fail the operation that produced the event.
 *   So there is no queue here at all. With no window to send to, an event is
 *   dropped, which is the same answer Tauri's `emit` gave.
 * - **Command streams** — the correlated response events of one in-flight
 *   request. Losing one of these is not degradation, it is corruption: a
 *   missing `body-chunk` produces a response body with a hole in it that the
 *   renderer would decode as if it were complete. So a stream is queued when it
 *   cannot be delivered, that queue is bounded, and reaching the bound fails
 *   the request.
 *
 * The one exception on the pushed side is progress. A progress event carries a
 * fraction, not a delta, so the only value that matters is the newest one —
 * sending an older one after it is strictly worse than dropping it. Those
 * coalesce to latest per correlation, which is also the only per-event storage
 * anywhere in this file, and it too is bounded.
 */

/**
 * The renderer end of the event path. Narrower than `WebContents` so the specs
 * exercise the real logic against the two members it uses.
 */
export type EventTarget = {
    readonly isDestroyed: () => boolean;
    readonly send: (channel: string, ...args: readonly unknown[]) => void;
};

/**
 * Events that coalesce to their latest value per correlation key.
 *
 * The key selector exists because coalescing on the event name alone would let
 * two concurrent analyses overwrite each other's progress, which reads in the
 * UI as a bar that jumps backwards. `analysisId` is the correlation the
 * renderer already filters on.
 */
export const COALESCED_EVENTS: ReadonlyMap<string, (payload: unknown) => string> = new Map([
    [
        'pitch-analysis-progress',
        (payload: unknown): string =>
            typeof payload === 'object' &&
            payload !== null &&
            'analysisId' in payload &&
            typeof payload.analysisId === 'string'
                ? payload.analysisId
                : '',
    ],
]);

/**
 * How many distinct coalescing keys may be held before the forwarder gives up
 * on batching and sends immediately.
 *
 * Coalescing stores one payload per live correlation, so the storage is bounded
 * by concurrent analyses — a small number in practice. The cap is what makes
 * that a guarantee rather than an expectation: past it, the forwarder stops
 * accumulating instead of growing a map from a producer it does not control.
 */
export const MAX_COALESCED_KEYS = 64;

/**
 * The map key holding one event name's latest payload for one correlation.
 *
 * Length-prefixed rather than joined by a separator. Both halves are
 * producer-supplied strings, so any separator character they may contain makes
 * the join ambiguous — two different pairs would land on one key and one
 * analysis would silently overwrite another's progress. The length prefix is
 * injective for every possible pair, and unlike a control-character delimiter
 * it leaves the source plain text.
 */
export const coalescingKey = (name: string, correlation: string): string =>
    `${String(name.length)}:${name}${correlation}`;

export type CreateEventForwarderInput = {
    /** The live window's `webContents`, or `undefined` while it is being recreated. */
    readonly target: () => EventTarget | undefined;
    /** Batches one flush. `queueMicrotask` in production, immediate in the specs. */
    readonly schedule: (flush: () => void) => void;
    readonly channel: string;
};

export type EventForwarder = {
    /** Called by the addon's threadsafe function, on the JS main thread. */
    readonly emit: (name: string, payload: unknown) => void;
    /** Send everything held. Exposed so the specs can observe without timing. */
    readonly flush: () => void;
    /** How many coalesced payloads are waiting. */
    readonly pending: () => number;
};

const liveTarget = (target: () => EventTarget | undefined): EventTarget | undefined => {
    const candidate = target();
    return candidate !== undefined && !candidate.isDestroyed() ? candidate : undefined;
};

export const createEventForwarder = ({ target, schedule, channel }: CreateEventForwarderInput): EventForwarder => {
    const coalesced = new Map<string, { readonly name: string; readonly payload: unknown }>();
    let flushScheduled = false;

    /**
     * `send` throws when the frame died between the liveness check and the
     * call, which is an ordinary race during a renderer crash. The throw is
     * swallowed because this function runs inside the addon's threadsafe
     * callback, on a driver thread's behalf: letting it out would turn a lost
     * fire-and-forget event into an exception in the MIDI or dictation path.
     */
    const sendNow = (name: string, payload: unknown): void => {
        try {
            liveTarget(target)?.send(channel, name, payload);
        } catch {
            // Dropped, like every other undeliverable pushed event.
        }
    };

    const flush = (): void => {
        flushScheduled = false;
        if (coalesced.size === 0) {
            return;
        }
        const held = [...coalesced.values()];
        // Cleared before sending, not after: `send` reaching a destroyed
        // webContents throws, and a throw between the send and the clear would
        // leave the map holding a payload nothing will ever flush again.
        coalesced.clear();
        for (const { name, payload } of held) {
            sendNow(name, payload);
        }
    };

    return {
        emit: (name, payload) => {
            const keyOf = COALESCED_EVENTS.get(name);
            if (keyOf === undefined) {
                sendNow(name, payload);
                return;
            }
            if (coalesced.size >= MAX_COALESCED_KEYS) {
                flush();
                sendNow(name, payload);
                return;
            }
            coalesced.set(coalescingKey(name, keyOf(payload)), { name, payload });
            if (!flushScheduled) {
                flushScheduled = true;
                schedule(flush);
            }
        },
        flush,
        pending: () => coalesced.size,
    };
};

/**
 * The per-request queue cap for a command stream.
 *
 * Matched to `MAX_PROVIDER_EVENTS` in the renderer's provider gateway, which is
 * the only streaming caller at present: the renderer already refuses a response
 * past that many events, so a deeper queue here could only ever hold events the
 * consumer has already decided to reject.
 */
export const STREAM_QUEUE_CAPACITY = 8192;

export type CreateCommandStreamInput = {
    readonly streamId: string;
    readonly target: () => EventTarget | undefined;
    readonly channel: string;
    readonly capacity?: number;
};

export type BoundedCommandStream = {
    readonly emit: (payload: unknown) => void;
    readonly failure: () => string | undefined;
    readonly close: () => void;
    readonly queued: () => number;
};

/**
 * A bounded, in-order stream for one in-flight request.
 *
 * Delivery is immediate whenever the renderer is there, so the queue is empty
 * in the ordinary case. It fills only when the window is gone — during a
 * renderer crash and its recreate — and at the cap the stream fails, which the
 * router turns into a rejected request. Dropping the oldest event instead would
 * hand the renderer a response body with a hole in it and no way to know.
 *
 * Order is preserved on the way out: once anything is queued, later events
 * queue behind it rather than overtaking it through the fast path.
 */
export const createCommandStream = ({
    streamId,
    target,
    channel,
    capacity = STREAM_QUEUE_CAPACITY,
}: CreateCommandStreamInput): BoundedCommandStream => {
    const queue: unknown[] = [];
    let failure: string | undefined;
    let closed = false;

    const fail = (reason: string): void => {
        failure = reason;
        queue.length = 0;
    };

    const drain = (): void => {
        const live = liveTarget(target);
        if (live === undefined) {
            return;
        }
        while (queue.length > 0) {
            // `shift` before `send`: a send that throws must not leave the
            // payload at the head to be retried forever.
            const payload = queue.shift();
            try {
                live.send(channel, streamId, payload);
            } catch (error) {
                // Unlike a pushed event, an undelivered stream event is not
                // droppable: the caller is waiting for a complete response, so
                // the request fails instead.
                fail(`the response stream could not be delivered: ${String(error)}`);
                return;
            }
        }
    };

    return {
        emit: (payload) => {
            if (closed || failure !== undefined) {
                return;
            }
            queue.push(payload);
            drain();
            if (queue.length > capacity) {
                fail(`the response stream exceeded its ${String(capacity)}-event queue`);
            }
        },
        failure: () => failure,
        close: () => {
            closed = true;
            queue.length = 0;
        },
        queued: () => queue.length,
    };
};

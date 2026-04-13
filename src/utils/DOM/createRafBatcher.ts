/**
 * Generic rAF-debouncing primitive for per-key last-write-wins updates.
 *
 * §33.2 / §57.1 — Six plugin bridges (Bacteria, Crust, Fermenter, Gluten,
 * Grinder, Levain) each held a pair of module-level Maps
 * (\`pendingUpdates\`, \`latestValues\`) plus a hand-rolled rAF-flush
 * function. The Sampler param bridge was a seventh copy. Every copy had
 * the same semantics:
 *
 *   - \`schedule(key, value)\` stores \`value\` as the "most recent" entry
 *     for \`key\` and schedules a single rAF if one isn't pending for it.
 *   - When the rAF fires, the most recent value is flushed and the entry
 *     is dropped.
 *   - Subsequent \`schedule\` calls within the same frame coalesce into a
 *     single flush carrying only the last value.
 *
 * The point of the debounce is to reduce postMessage churn to the audio
 * engine when a UI control is dragged: at 60Hz drag events we fire one
 * update per frame instead of one per pointermove. This primitive
 * captures that behaviour in one place so each bridge only has to
 * supply the flush side-effect.
 *
 * Not a React hook — it's a plain object factory, usable from any
 * module-level context.
 */

export type RafBatcher<V> = {
    /**
     * Record \`value\` as the latest for \`key\` and ensure exactly one rAF
     * is pending for it. Subsequent calls before the rAF fires overwrite
     * the value without scheduling another frame.
     */
    schedule: (key: string, value: V, flush: (key: string, value: V) => void) => void;
    /**
     * Drop any pending entry for \`key\` without flushing. Callers use this
     * when a higher-priority synchronous write has already applied the
     * value (e.g. immediate mode).
     */
    cancel: (key: string) => void;
    /** Drop all pending entries without flushing. For teardown. */
    cancelAll: () => void;
    /** Number of entries currently pending. Test aid. */
    readonly pendingSize: number;
};

export const createRafBatcher = <V>(): RafBatcher<V> => {
    type Entry = { rafId: number; value: V; flush: (key: string, value: V) => void };
    const pending = new Map<string, Entry>();

    const schedule = (key: string, value: V, flush: (key: string, value: V) => void): void => {
        const existing = pending.get(key);
        if (existing) {
            // rAF already scheduled for this key — just update the latest value
            // and the flush callback. Overwriting `flush` is correct: the newest
            // caller owns the flush semantics for the coalesced write.
            existing.value = value;
            existing.flush = flush;
            return;
        }
        const rafId = requestAnimationFrame(() => {
            const entry = pending.get(key);
            if (!entry) {
                // Cancelled between schedule and the rAF callback.
                return;
            }
            pending.delete(key);
            entry.flush(key, entry.value);
        });
        pending.set(key, { rafId, value, flush });
    };

    const cancel = (key: string): void => {
        const entry = pending.get(key);
        if (!entry) {
            return;
        }
        cancelAnimationFrame(entry.rafId);
        pending.delete(key);
    };

    const cancelAll = (): void => {
        for (const entry of pending.values()) {
            cancelAnimationFrame(entry.rafId);
        }
        pending.clear();
    };

    return {
        schedule,
        cancel,
        cancelAll,
        get pendingSize() {
            return pending.size;
        },
    };
};

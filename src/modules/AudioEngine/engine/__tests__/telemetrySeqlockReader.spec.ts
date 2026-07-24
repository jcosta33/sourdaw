import { describe, it, expect } from 'vitest';

import {
    FLOATS_PER_SLOT,
    TELEMETRY_SEQ_IDX,
    TELEMETRY_SEQ_MAX_RETRIES,
    readTelemetrySnapshot,
} from '../telemetryAllocator';

/**
 * Audit RT-2 — the shared seqlock reader for telemetry slots.
 *
 * The worklet writes a multi-field snapshot with plain (non-atomic) float
 * stores. A main-thread poll that lands between two of those stores reads a
 * torn snapshot: some fields from the new write, some from the previous one.
 * `readTelemetrySnapshot` samples the slot's generation counter around the
 * projection and retries when the counter is odd (write in progress) or moved
 * (a write completed mid-read).
 *
 * The interleaving here is deterministic, not raced: the projection callback
 * itself performs the simulated worklet write between reading field `a` and
 * field `b`, which is exactly the window a real poll can land in.
 */

type Snapshot = { a: number; b: number };

function makeSlot(): { view: Float32Array; seqView: Int32Array } {
    const sab = new SharedArrayBuffer(FLOATS_PER_SLOT * Float32Array.BYTES_PER_ELEMENT);
    return { view: new Float32Array(sab), seqView: new Int32Array(sab) };
}

/** One worklet publish cycle: counter odd, both fields, counter even. */
function publish(view: Float32Array, seqView: Int32Array, a: number, b: number): void {
    Atomics.store(seqView, TELEMETRY_SEQ_IDX, Atomics.load(seqView, TELEMETRY_SEQ_IDX) + 1);
    view[0] = a;
    view[1] = b;
    Atomics.store(seqView, TELEMETRY_SEQ_IDX, Atomics.load(seqView, TELEMETRY_SEQ_IDX) + 1);
}

describe('readTelemetrySnapshot — telemetry seqlock reader (audit RT-2)', () => {
    it('tears when the counter is ignored: fields split across two generations', () => {
        // Control case — this is the pre-fix reader in Gluten/Grinder/Bacteria/
        // Scoring: read slot floats straight, no counter, no retry.
        const { view, seqView } = makeSlot();
        publish(view, seqView, 1, 10);

        const a = view[0]!;
        publish(view, seqView, 2, 20);
        const b = view[1]!;

        // Generation 1's `a` mixed with generation 2's `b` — a snapshot that was
        // never published.
        expect({ a, b }).toEqual({ a: 1, b: 20 });
    });

    it('retries past a write that lands mid-read and returns a single generation', () => {
        const { view, seqView } = makeSlot();
        publish(view, seqView, 1, 10);

        let attempts = 0;
        const project = (slotView: Float32Array): Snapshot => {
            attempts++;
            const a = slotView[0]!;
            if (attempts === 1) {
                // The worklet publishes generation 2 while the reader sits
                // between its two field reads.
                publish(view, seqView, 2, 20);
            }
            const b = slotView[1]!;
            return { a, b };
        };

        const snapshot = readTelemetrySnapshot({ view, seqView, project });

        expect(attempts).toBe(2);
        // Both fields from generation 2 — never the torn {a: 1, b: 20}.
        expect(snapshot).toEqual({ a: 2, b: 20 });
    });

    it('retries while the counter is odd, so a half-written slot is never returned', () => {
        const { view, seqView } = makeSlot();
        publish(view, seqView, 1, 10);

        // Writer opened the seqlock and wrote only `a` so far.
        Atomics.store(seqView, TELEMETRY_SEQ_IDX, Atomics.load(seqView, TELEMETRY_SEQ_IDX) + 1);
        view[0] = 2;

        let attempts = 0;
        const project = (slotView: Float32Array): Snapshot => {
            attempts++;
            if (attempts === 1) {
                // Writer finishes the field and closes the seqlock between the
                // rejected first attempt and the retry.
                view[1] = 20;
                Atomics.store(seqView, TELEMETRY_SEQ_IDX, Atomics.load(seqView, TELEMETRY_SEQ_IDX) + 1);
            }
            return { a: slotView[0]!, b: slotView[1]! };
        };

        const snapshot = readTelemetrySnapshot({ view, seqView, project });

        expect(attempts).toBe(2);
        expect(snapshot).toEqual({ a: 2, b: 20 });
    });

    it('accepts a settled slot on the first attempt with no retry', () => {
        const { view, seqView } = makeSlot();
        publish(view, seqView, 7, 70);

        let attempts = 0;
        const snapshot = readTelemetrySnapshot({
            view,
            seqView,
            project: (slotView): Snapshot => {
                attempts++;
                return { a: slotView[0]!, b: slotView[1]! };
            },
        });

        expect(attempts).toBe(1);
        expect(snapshot).toEqual({ a: 7, b: 70 });
    });

    it('gives up after the bounded retry budget instead of spinning the main thread', () => {
        const { view, seqView } = makeSlot();
        publish(view, seqView, 3, 30);
        // Writer stalled with the seqlock open — the counter never goes even.
        Atomics.store(seqView, TELEMETRY_SEQ_IDX, Atomics.load(seqView, TELEMETRY_SEQ_IDX) + 1);

        let attempts = 0;
        const snapshot = readTelemetrySnapshot({
            view,
            seqView,
            project: (slotView): Snapshot => {
                attempts++;
                return { a: slotView[0]!, b: slotView[1]! };
            },
        });

        expect(attempts).toBe(TELEMETRY_SEQ_MAX_RETRIES + 1);
        // Bounded staleness, not a hang: the last read is handed back.
        expect(snapshot).toEqual({ a: 3, b: 30 });
    });
});

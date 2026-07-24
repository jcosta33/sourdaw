import { describe, it, expect } from 'vitest';

import {
    FLOATS_PER_SLOT,
    TELEMETRY_SEQ_IDX,
    TELEMETRY_SEQ_MAX_RETRIES,
    createTelemetryReader,
    type TelemetrySlot,
} from '../telemetryAllocator';

/**
 * Audit RT-2 — the shared seqlock reader for telemetry slots.
 *
 * The worklet writes a multi-field snapshot with plain (non-atomic) float
 * stores. A main-thread poll that lands between two of those stores reads a
 * torn snapshot: some fields from the new write, some from the previous one.
 * The reader samples the slot's generation counter around the projection and
 * retries when the counter is odd (write in progress) or moved (a write
 * completed mid-read).
 *
 * The interleavings here are deterministic, not raced: the projection callback
 * itself performs the simulated worklet write between reading field `a` and
 * field `b`, which is exactly the window a real poll can land in.
 *
 * The contract under test is absolute — **a torn snapshot is never returned**,
 * including when the retry budget runs out.
 */

type Snapshot = { a: number; b: number };

function makeSlot(): TelemetrySlot {
    const sab = new SharedArrayBuffer(FLOATS_PER_SLOT * Float32Array.BYTES_PER_ELEMENT);
    return {
        sab,
        byteOffset: 0,
        view: new Float32Array(sab),
        seqView: new Int32Array(sab),
    };
}

function bumpSeq(seqView: Int32Array): void {
    Atomics.store(seqView, TELEMETRY_SEQ_IDX, Atomics.load(seqView, TELEMETRY_SEQ_IDX) + 1);
}

/** One worklet publish cycle: counter odd, both fields, counter even. */
function publish(slot: TelemetrySlot, a: number, b: number): void {
    bumpSeq(slot.seqView);
    slot.view[0] = a;
    slot.view[1] = b;
    bumpSeq(slot.seqView);
}

const projectAB = (view: Float32Array): Snapshot => ({ a: view[0]!, b: view[1]! });

describe('createTelemetryReader — telemetry seqlock reader (audit RT-2)', () => {
    it('tears when the counter is ignored: fields split across two generations', () => {
        // Control case — this is the pre-fix reader in Gluten/Grinder/Bacteria/
        // Scoring: read slot floats straight, no counter, no retry.
        const slot = makeSlot();
        publish(slot, 1, 10);

        const a = slot.view[0]!;
        publish(slot, 2, 20);
        const b = slot.view[1]!;

        // Generation 1's `a` mixed with generation 2's `b` — a snapshot that was
        // never published.
        expect({ a, b }).toEqual({ a: 1, b: 20 });
    });

    it('retries past a write that lands mid-read and returns a single generation', () => {
        const slot = makeSlot();
        publish(slot, 1, 10);

        let attempts = 0;
        let publishMidRead = false;
        const read = createTelemetryReader({
            slot,
            project: (view): Snapshot => {
                attempts++;
                const a = view[0]!;
                if (publishMidRead) {
                    publishMidRead = false;
                    // The worklet publishes generation 2 while the reader sits
                    // between its two field reads.
                    publish(slot, 2, 20);
                }
                return { a, b: view[1]! };
            },
        });
        // Arm the interleaving only for the first *read* attempt — the reader
        // also projects once at construction to build its neutral fallback, and
        // that call must not consume the trigger.
        attempts = 0;
        publishMidRead = true;

        const snapshot = read();

        expect(attempts).toBe(2);
        // Both fields from generation 2 — never the torn {a: 1, b: 20}.
        expect(snapshot).toEqual({ a: 2, b: 20 });
    });

    it('retries while the counter is odd, so a half-written slot is never returned', () => {
        const slot = makeSlot();
        publish(slot, 1, 10);

        // Writer opened the seqlock and wrote only `a` so far.
        bumpSeq(slot.seqView);
        slot.view[0] = 2;

        let attempts = 0;
        let finishWriteMidRead = false;
        const read = createTelemetryReader({
            slot,
            project: (view): Snapshot => {
                attempts++;
                if (finishWriteMidRead) {
                    finishWriteMidRead = false;
                    // Writer finishes the field and closes the seqlock between the
                    // rejected first attempt and the retry.
                    slot.view[1] = 20;
                    bumpSeq(slot.seqView);
                }
                return { a: view[0]!, b: view[1]! };
            },
        });
        // Arm for the first *read* attempt: the construction-time projection
        // (neutral fallback) must not consume the trigger.
        attempts = 0;
        finishWriteMidRead = true;

        const snapshot = read();

        expect(attempts).toBe(2);
        expect(snapshot).toEqual({ a: 2, b: 20 });
    });

    it('accepts a settled slot on the first attempt with no retry', () => {
        const slot = makeSlot();
        publish(slot, 7, 70);

        let attempts = 0;
        const read = createTelemetryReader({
            slot,
            project: (view): Snapshot => {
                attempts++;
                return { a: view[0]!, b: view[1]! };
            },
        });
        // Discount the one construction-time projection that builds the neutral
        // fallback, so this counts read attempts only.
        attempts = 0;

        const snapshot = read();

        expect(attempts).toBe(1);
        expect(snapshot).toEqual({ a: 7, b: 70 });
    });

    it('returns the last consistent snapshot — not the torn one — when a writer dies mid-publish', () => {
        // The case the guarantee rests on: the slot is left genuinely torn
        // (`a` from generation 2, `b` still from generation 1) with the counter
        // stuck odd, so every retry fails validation.
        const slot = makeSlot();
        publish(slot, 1, 10);

        const read = createTelemetryReader({ slot, project: projectAB });
        expect(read()).toEqual({ a: 1, b: 10 });

        bumpSeq(slot.seqView); // writer opens the seqlock…
        slot.view[0] = 2; // …writes one field…
        // …and dies. The counter never goes even again.

        // The same projection, run without seqlock validation, sees the mixed
        // generation right now — this is exactly what must not be returned:
        expect(projectAB(slot.view)).toEqual({ a: 2, b: 10 });

        // The reader must not hand that out. Stale-but-consistent instead.
        expect(read()).toEqual({ a: 1, b: 10 });
        expect(read()).toEqual({ a: 1, b: 10 });
    });

    it('gives up after the bounded retry budget instead of spinning the main thread', () => {
        const slot = makeSlot();
        publish(slot, 3, 30);
        // Writer stalled with the seqlock open — the counter never goes even.
        bumpSeq(slot.seqView);

        let attempts = 0;
        const read = createTelemetryReader({
            slot,
            project: (view): Snapshot => {
                attempts++;
                return { a: view[0]!, b: view[1]! };
            },
        });
        // Discount the construction-time projection; count read attempts only.
        attempts = 0;

        const snapshot = read();

        expect(attempts).toBe(TELEMETRY_SEQ_MAX_RETRIES + 1);
        // Nothing ever validated for this reader, so it falls back to the
        // zeroed-slot projection — a single consistent generation, not the
        // values sitting in the slot behind the open seqlock.
        expect(snapshot).toEqual({ a: 0, b: 0 });
    });

    it('starts from the zeroed-slot projection before any read has validated', () => {
        const slot = makeSlot();
        publish(slot, 5, 50);
        bumpSeq(slot.seqView); // writer stuck open from the very first poll

        // Scoring's projection is branch-valued: a zeroed slot means "inactive",
        // which is exactly the neutral reading a never-written slot should give.
        const read = createTelemetryReader({
            slot,
            project: (view): { active: boolean; note: number } => {
                if (view[0] === 0) {
                    return { active: false, note: 0 };
                }
                return { active: true, note: view[1]! };
            },
        });

        expect(read()).toEqual({ active: false, note: 0 });
    });

    it('keeps caching forward: each validated read replaces the fallback', () => {
        const slot = makeSlot();
        const read = createTelemetryReader({ slot, project: projectAB });

        publish(slot, 1, 10);
        expect(read()).toEqual({ a: 1, b: 10 });
        publish(slot, 2, 20);
        expect(read()).toEqual({ a: 2, b: 20 });

        // Writer now dies mid-publish: the retained snapshot is the newest
        // validated one (generation 2), not the first.
        bumpSeq(slot.seqView);
        slot.view[0] = 3;

        expect(read()).toEqual({ a: 2, b: 20 });
    });
});

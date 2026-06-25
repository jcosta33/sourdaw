import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Tests for the Grand Boule consumer's SPSC acquire read.
 *
 * `readBlockAcquire` is the consumer half of the lock-free ring: it acquires the
 * published write head with `Atomics.load`, then copies frames out. The fix
 * makes the acquire ordering explicit and testable through a public surface.
 *
 * The module registers an AudioWorkletProcessor on load, so the worklet globals
 * are shimmed before importing the real function.
 */

// Worklet-scope globals the module references at load time.
(globalThis as unknown as { AudioWorkletProcessor: unknown }).AudioWorkletProcessor = class {
    port = { onmessage: null as unknown, postMessage: vi.fn() };
};
(globalThis as unknown as { registerProcessor: unknown }).registerProcessor = () => {};

let readBlockAcquire: typeof import('../grandBouleProcessor').readBlockAcquire;
beforeAll(async () => {
    ({ readBlockAcquire } = await import('../grandBouleProcessor'));
});

const WRITE_HEAD_IDX = 0;
const READ_HEAD_IDX = 1;

/** Build a SAB with `ringFrames` stereo frames and the two atomic head ints. */
function makeSab(ringFrames: number): {
    controlInts: Int32Array;
    leftRing: Float32Array;
    rightRing: Float32Array;
} {
    const headerBytes = 2 * Int32Array.BYTES_PER_ELEMENT;
    const sab = new SharedArrayBuffer(headerBytes + ringFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
    const controlInts = new Int32Array(sab, 0, 2);
    const leftRing = new Float32Array(sab, headerBytes, ringFrames);
    const rightRing = new Float32Array(sab, headerBytes + ringFrames * Float32Array.BYTES_PER_ELEMENT, ringFrames);
    return { controlInts, leftRing, rightRing };
}

describe('readBlockAcquire (SPSC acquire read)', () => {
    it('copies the published block into both output channels and advances the read head', () => {
        const ringFrames = 16;
        const { controlInts, leftRing, rightRing } = makeSab(ringFrames);

        const frames = 4;
        for (let i = 0; i < frames; i++) {
            leftRing[i] = i + 1; // 1,2,3,4
            rightRing[i] = -(i + 1); // -1,-2,-3,-4
        }
        // Producer published `frames` frames via a release store.
        Atomics.store(controlInts, WRITE_HEAD_IDX, frames);

        const out0 = new Float32Array(frames);
        const out1 = new Float32Array(frames);
        const { consumed, nextReadHead } = readBlockAcquire(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            out0,
            out1,
            frames
        );

        expect(consumed).toBe(frames);
        expect(nextReadHead).toBe(frames);
        expect(Array.from(out0)).toEqual([1, 2, 3, 4]);
        expect(Array.from(out1)).toEqual([-1, -2, -3, -4]);
    });

    it('does not copy any frames or advance the head on underrun (fewer published than requested)', () => {
        const ringFrames = 16;
        const { controlInts, leftRing, rightRing } = makeSab(ringFrames);
        leftRing[0] = 99;
        rightRing[0] = 99;
        Atomics.store(controlInts, WRITE_HEAD_IDX, 2); // only 2 published
        Atomics.store(controlInts, READ_HEAD_IDX, 0);

        const out0 = new Float32Array(4).fill(7); // pre-filled sentinel
        const out1 = new Float32Array(4).fill(7);
        const { consumed, nextReadHead } = readBlockAcquire(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            out0,
            out1,
            4
        );

        expect(consumed).toBe(0);
        expect(nextReadHead).toBe(0);
        // Outputs untouched — caller emits silence, no stale ring frames leak in.
        expect(Array.from(out0)).toEqual([7, 7, 7, 7]);
    });

    it('reads a block that wraps the ring boundary, in order, from the published window', () => {
        const ringFrames = 4;
        const { controlInts, leftRing, rightRing } = makeSab(ringFrames);

        // Producer has written 4 then wrapped to write 2 more: read head 2,
        // write head 6. Published frames map to slots 2,3,0,1.
        leftRing[0] = 50; // wrapped (frame index 4)
        leftRing[1] = 60; // wrapped (frame index 5)
        leftRing[2] = 30; // frame index 2
        leftRing[3] = 40; // frame index 3
        rightRing[0] = -50;
        rightRing[1] = -60;
        rightRing[2] = -30;
        rightRing[3] = -40;
        Atomics.store(controlInts, READ_HEAD_IDX, 2);
        Atomics.store(controlInts, WRITE_HEAD_IDX, 6);

        const out0 = new Float32Array(4);
        const out1 = new Float32Array(4);
        const { consumed, nextReadHead } = readBlockAcquire(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            out0,
            out1,
            4
        );

        expect(consumed).toBe(4);
        expect(nextReadHead).toBe(6);
        expect(Array.from(out0)).toEqual([30, 40, 50, 60]);
        expect(Array.from(out1)).toEqual([-30, -40, -50, -60]);
    });

    it('handles a mono output (no right channel) without error', () => {
        const ringFrames = 8;
        const { controlInts, leftRing, rightRing } = makeSab(ringFrames);
        leftRing[0] = 1;
        leftRing[1] = 2;
        Atomics.store(controlInts, WRITE_HEAD_IDX, 2);

        const out0 = new Float32Array(2);
        const { consumed } = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0, undefined, 2);
        expect(consumed).toBe(2);
        expect(Array.from(out0)).toEqual([1, 2]);
    });
});

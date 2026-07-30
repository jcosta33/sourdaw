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

// Worklet-scope globals the module references at load time. The registry
// captures the processor constructor so the real instance can be exercised.
const registry = new Map<string, new () => GrandBouleProcessorLike>();
(globalThis as unknown as { AudioWorkletProcessor: unknown }).AudioWorkletProcessor = class {
    port = { onmessage: null as unknown, postMessage: vi.fn() };
};
(globalThis as unknown as { registerProcessor: unknown }).registerProcessor = (
    name: string,
    proc: new () => GrandBouleProcessorLike
) => {
    registry.set(name, proc);
};

type GrandBouleProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

let readBlockAcquire: typeof import('../grandBouleProcessor').readBlockAcquire;
beforeAll(async () => {
    ({ readBlockAcquire } = await import('../grandBouleProcessor'));
});

const WRITE_HEAD_IDX = 0;
const READ_HEAD_IDX = 1;

/** Build a SAB with `ringFrames` stereo frames and the two atomic head ints. */
function makeSab(ringFrames: number): {
    sab: SharedArrayBuffer;
    controlInts: Int32Array;
    leftRing: Float32Array;
    rightRing: Float32Array;
} {
    const headerBytes = 7 * Int32Array.BYTES_PER_ELEMENT;
    const sab = new SharedArrayBuffer(headerBytes + ringFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
    const controlInts = new Int32Array(sab, 0, 7);
    const leftRing = new Float32Array(sab, headerBytes, ringFrames);
    const rightRing = new Float32Array(sab, headerBytes + ringFrames * Float32Array.BYTES_PER_ELEMENT, ringFrames);
    return { sab, controlInts, leftRing, rightRing };
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
        const consumed = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0, out1, frames);

        expect(consumed).toBe(true);
        expect(Atomics.load(controlInts, READ_HEAD_IDX)).toBe(frames);
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
        const consumed = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0, out1, 4);

        expect(consumed).toBe(false);
        expect(Atomics.load(controlInts, READ_HEAD_IDX)).toBe(0);
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
        const consumed = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0, out1, 4);

        expect(consumed).toBe(true);
        expect(Atomics.load(controlInts, READ_HEAD_IDX)).toBe(6);
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
        const consumed = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0, undefined, 2);
        expect(consumed).toBe(true);
        expect(Array.from(out0)).toEqual([1, 2]);
    });
});

describe('GrandBouleProcessor (real instance)', () => {
    let GrandBouleProcessor: new () => GrandBouleProcessorLike;

    beforeAll(() => {
        GrandBouleProcessor = registry.get('grand-boule-processor')!;
    });

    function newProc(): GrandBouleProcessorLike {
        return new GrandBouleProcessor();
    }

    function send(proc: GrandBouleProcessorLike, sab: SharedArrayBuffer): void {
        proc.port.onmessage?.({ data: { type: 'init', sab } });
    }

    it('init posts ready, parses the ring layout, and ignores a second init', () => {
        const proc = newProc();
        const { sab } = makeSab(8);
        send(proc, sab);
        expect(proc.port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
        // Second init is ignored (already ready).
        const callsBefore = proc.port.postMessage.mock.calls.length;
        send(proc, sab);
        expect(proc.port.postMessage.mock.calls.length).toBe(callsBefore);
    });

    it('process is a no-op before init (no ring wired)', () => {
        const proc = newProc();
        const out = [new Float32Array(4).fill(9), new Float32Array(4).fill(9)];
        proc.process([], [out]);
        expect(Array.from(out[0]!)).toEqual([9, 9, 9, 9]);
    });

    it('process guards: returns early when output absent, empty, or left channel absent', () => {
        const proc = newProc();
        const { sab } = makeSab(8);
        send(proc, sab);
        // No output bus.
        proc.process([], []);
        // Empty output bus.
        proc.process([], [[]]);
        // Left channel absent.
        proc.process([], [[undefined as unknown as Float32Array, new Float32Array(4)]]);
        // None of these throw.
        expect(true).toBe(true);
    });

    it('consumes published frames and advances the read head; underrun emits silence', () => {
        const proc = newProc();
        const { controlInts, leftRing, rightRing, sab } = makeSab(8);
        send(proc, sab);

        // Publish 4 frames.
        for (let i = 0; i < 4; i++) {
            leftRing[i] = i + 1;
            rightRing[i] = -(i + 1);
        }
        Atomics.store(controlInts, WRITE_HEAD_IDX, 4);

        const out = [new Float32Array(4).fill(0), new Float32Array(4).fill(0)];
        proc.process([], [out]);
        expect(Array.from(out[0]!)).toEqual([1, 2, 3, 4]);
        expect(Array.from(out[1]!)).toEqual([-1, -2, -3, -4]);
        // Read head advanced by the consumed count.
        expect(Atomics.load(controlInts, READ_HEAD_IDX)).toBe(4);

        // Next call underruns (nothing published) → output is silent, head unchanged.
        const out2 = [new Float32Array(4).fill(5), new Float32Array(4).fill(5)];
        proc.process([], [out2]);
        expect(Array.from(out2[0]!)).toEqual([0, 0, 0, 0]);
        expect(Atomics.load(controlInts, READ_HEAD_IDX)).toBe(4);
    });

    it('keeps expected DSP sleep silent without requesting worker renders', () => {
        const proc = newProc();
        const { controlInts, sab } = makeSab(8);
        Atomics.store(controlInts, 3, 0);
        Atomics.store(controlInts, 4, 3);
        send(proc, sab);

        const out = [new Float32Array(4).fill(5), new Float32Array(4).fill(5)];
        proc.process([], [out]);

        expect(Array.from(out[0]!)).toEqual([0, 0, 0, 0]);
        expect(Atomics.load(controlInts, 2)).toBe(0);
    });

    it('drops only through the hard-flush boundary and preserves audio rendered by a later wake', () => {
        const proc = newProc();
        const { controlInts, leftRing, rightRing, sab } = makeSab(8);
        leftRing.fill(1);
        rightRing.fill(1);
        Atomics.store(controlInts, WRITE_HEAD_IDX, 4);
        send(proc, sab);

        Atomics.store(controlInts, 6, 4);
        Atomics.add(controlInts, 5, 1);
        leftRing.fill(2, 4);
        rightRing.fill(-2, 4);
        Atomics.store(controlInts, WRITE_HEAD_IDX, 8);
        Atomics.store(controlInts, 4, 0);
        const out = [new Float32Array(4).fill(5), new Float32Array(4).fill(5)];
        proc.process([], [out]);

        expect(Array.from(out[0]!)).toEqual([0, 0, 0, 0]);
        expect(Atomics.load(controlInts, READ_HEAD_IDX)).toBe(4);

        const wakeOut = [new Float32Array(4), new Float32Array(4)];
        proc.process([], [wakeOut]);
        expect(Array.from(wakeOut[0]!)).toEqual([2, 2, 2, 2]);
        expect(Array.from(wakeOut[1]!)).toEqual([-2, -2, -2, -2]);
    });
});

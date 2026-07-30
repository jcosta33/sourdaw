import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Tests for the Grand Boule engine worker's SPSC release write.
 *
 * `writeBlockRelease` is the producer half of the lock-free ring: it copies a
 * rendered block into the rings, then publishes the new write head with
 * `Atomics.store` — the release fence sequenced after the data writes. Paired
 * with the consumer's `readBlockAcquire`, no head increment is ever observable
 * without its matching frames.
 *
 * The worker wires `self.onmessage` on load, so `self` is shimmed before import.
 */

Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: { onmessage: null, postMessage: vi.fn() },
});

let writeBlockRelease: typeof import('../grandBouleEngineWorker').writeBlockRelease;
let readBlockAcquire: typeof import('../../services/grandBouleProcessor').readBlockAcquire;

beforeAll(async () => {
    ({ writeBlockRelease } = await import('../grandBouleEngineWorker'));
    // The consumer needs the worklet globals; shim then import.
    (globalThis as unknown as { AudioWorkletProcessor: unknown }).AudioWorkletProcessor = class {
        port = { onmessage: null as unknown, postMessage: vi.fn() };
    };
    (globalThis as unknown as { registerProcessor: unknown }).registerProcessor = () => {};
    ({ readBlockAcquire } = await import('../../services/grandBouleProcessor'));
});

const WRITE_HEAD_IDX = 0;
const BLOCK = 8;

function makeSab(ringFrames: number): {
    controlInts: Int32Array;
    leftRing: Float32Array;
    rightRing: Float32Array;
} {
    const headerBytes = 7 * Int32Array.BYTES_PER_ELEMENT;
    const sab = new SharedArrayBuffer(headerBytes + ringFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
    const controlInts = new Int32Array(sab, 0, 7);
    const leftRing = new Float32Array(sab, headerBytes, ringFrames);
    const rightRing = new Float32Array(sab, headerBytes + ringFrames * Float32Array.BYTES_PER_ELEMENT, ringFrames);
    return { controlInts, leftRing, rightRing };
}

describe('writeBlockRelease (SPSC release write)', () => {
    it('writes the block into both rings and publishes the head only afterwards', () => {
        const ringFrames = 32;
        const { controlInts, leftRing, rightRing } = makeSab(ringFrames);

        const leftSrc = Float32Array.from({ length: BLOCK }, (_, i) => i + 1);
        const rightSrc = Float32Array.from({ length: BLOCK }, (_, i) => -(i + 1));

        const next = writeBlockRelease(controlInts, leftRing, rightRing, ringFrames, 0, leftSrc, rightSrc, BLOCK);

        // Release store advanced the head by exactly one block.
        expect(next).toBe(BLOCK);
        expect(Atomics.load(controlInts, WRITE_HEAD_IDX)).toBe(BLOCK);
        // Every frame the published head accounts for is present in the ring.
        for (let i = 0; i < BLOCK; i++) {
            expect(leftRing[i]).toBe(i + 1);
            expect(rightRing[i]).toBe(-(i + 1));
        }
    });

    it('splits a block across the ring boundary and keeps both rings consistent with the head', () => {
        // 12-frame ring with an 8-frame block: the second write starts at slot 8
        // (offset 8), so 4 frames land at 8..11 and 4 wrap to slots 0..3. This
        // exercises the secondChunk path that a release that skipped the wrap
        // would leave stale.
        const ringFrames = 12;
        const { controlInts, leftRing, rightRing } = makeSab(ringFrames);

        // First block fills slots 0..7, head → 8.
        let head = writeBlockRelease(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            0,
            Float32Array.from({ length: BLOCK }, () => 1),
            Float32Array.from({ length: BLOCK }, () => 1),
            BLOCK
        );

        // Second block at head 8 → straddles the boundary.
        const left = Float32Array.from({ length: BLOCK }, (_, i) => i + 100);
        const right = Float32Array.from({ length: BLOCK }, (_, i) => -(i + 100));
        head = writeBlockRelease(controlInts, leftRing, rightRing, ringFrames, head, left, right, BLOCK);

        expect(head).toBe(BLOCK * 2);
        expect(Atomics.load(controlInts, WRITE_HEAD_IDX)).toBe(BLOCK * 2);

        // Frames 0..3 of the second block at slots 8..11; frames 4..7 wrapped to 0..3.
        for (let i = 0; i < 4; i++) {
            expect(leftRing[8 + i]).toBe(100 + i);
            expect(rightRing[8 + i]).toBe(-(100 + i));
        }
        for (let i = 0; i < 4; i++) {
            expect(leftRing[i]).toBe(104 + i);
            expect(rightRing[i]).toBe(-(104 + i));
        }
    });
});

describe('producer release ↔ consumer acquire round-trip', () => {
    it('delivers exactly the frames the producer published, in order, across a wrap', () => {
        const ringFrames = BLOCK * 2; // 16 frames
        const { controlInts, leftRing, rightRing } = makeSab(ringFrames);

        // Producer writes three blocks; consumer reads two, leaving the third.
        const blocks = [0, 1, 2].map((b) => Float32Array.from({ length: BLOCK }, (_, i) => b * BLOCK + i));
        let writeHead = 0;
        // Produce block 0 and 1 (fills the ring), consumer drains both, then
        // produce block 2 into the now-free space (wrap), consumer reads it.
        writeHead = writeBlockRelease(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            writeHead,
            blocks[0]!,
            blocks[0]!,
            BLOCK
        );
        writeHead = writeBlockRelease(
            controlInts,
            leftRing,
            rightRing,
            ringFrames,
            writeHead,
            blocks[1]!,
            blocks[1]!,
            BLOCK
        );

        // Consumer acquires + drains both published blocks.
        const out0a = new Float32Array(BLOCK);
        const out1a = new Float32Array(BLOCK);
        const r1 = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0a, out1a, BLOCK);
        const out0b = new Float32Array(BLOCK);
        const out1b = new Float32Array(BLOCK);
        const r2 = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0b, out1b, BLOCK);

        expect(r1).toBe(true);
        expect(r2).toBe(true);
        expect(Array.from(out0a)).toEqual(Array.from(blocks[0]!));
        expect(Array.from(out0b)).toEqual(Array.from(blocks[1]!));

        // Produce block 2 — this write wraps over the freed slots.
        writeBlockRelease(controlInts, leftRing, rightRing, ringFrames, writeHead, blocks[2]!, blocks[2]!, BLOCK);
        const out0c = new Float32Array(BLOCK);
        const out1c = new Float32Array(BLOCK);
        const r3 = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0c, out1c, BLOCK);

        expect(r3).toBe(true);
        expect(Array.from(out0c)).toEqual(Array.from(blocks[2]!));
        expect(Array.from(out1c)).toEqual(Array.from(blocks[2]!));
    });
});

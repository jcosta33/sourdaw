import { describe, it, expect, beforeEach } from 'vitest';

import { DROPOUT_IDX, dropoutCounters } from '../dropoutCounter';

/**
 * Audit RT-10 — the engine had no dropout/xrun observability at all: Grand
 * Boule already *detected* ring-buffer starvation and silently emitted silence,
 * leaving no trace for anyone diagnosing a glitch.
 *
 * The counters live in a SharedArrayBuffer the render thread bumps with
 * `Atomics.add`, so the main thread reads them straight out of memory — no
 * polling of the audio thread, no messages. These specs stand in for the
 * worklet by writing the same SAB the worklet is handed.
 */

describe('dropoutCounters — engine dropout tally (audit RT-10)', () => {
    beforeEach(() => {
        dropoutCounters.reset();
    });

    it('reads zero on a clean run', () => {
        expect(dropoutCounters.read()).toEqual({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            lastUnderrunAtFrame: 0,
            bridgeDroppedBlocks: 0,
        });
    });

    it('surfaces block count, silent frames and the render frame a writer records', () => {
        const sab = dropoutCounters.getSab();
        expect(sab).not.toBeNull();
        const workletView = new Int32Array(sab!);

        // Two simulated worklet-side underruns, 128 frames each.
        Atomics.add(workletView, DROPOUT_IDX.detectedUnderrunBlocks, 1);
        Atomics.add(workletView, DROPOUT_IDX.silentFrames, 128);
        Atomics.store(workletView, DROPOUT_IDX.lastUnderrunAtFrame, 4_096);
        Atomics.add(workletView, DROPOUT_IDX.detectedUnderrunBlocks, 1);
        Atomics.add(workletView, DROPOUT_IDX.silentFrames, 128);
        Atomics.store(workletView, DROPOUT_IDX.lastUnderrunAtFrame, 8_192);

        expect(dropoutCounters.read()).toEqual({
            detectedUnderrunBlocks: 2,
            silentFrames: 256,
            lastUnderrunAtFrame: 8_192,
            bridgeDroppedBlocks: 0,
        });
    });

    it('hands every worklet the same buffer so counts from several devices aggregate', () => {
        const first = dropoutCounters.getSab();
        const second = dropoutCounters.getSab();

        expect(second).toBe(first);

        // Two devices, each writing through its own view over that one buffer.
        Atomics.add(new Int32Array(first!), DROPOUT_IDX.detectedUnderrunBlocks, 1);
        Atomics.add(new Int32Array(second!), DROPOUT_IDX.detectedUnderrunBlocks, 1);

        expect(dropoutCounters.read().detectedUnderrunBlocks).toBe(2);
    });

    it('clears the tally on reset so a fresh session does not inherit old counts', () => {
        const view = new Int32Array(dropoutCounters.getSab()!);
        Atomics.add(view, DROPOUT_IDX.detectedUnderrunBlocks, 3);
        Atomics.add(view, DROPOUT_IDX.silentFrames, 384);
        Atomics.store(view, DROPOUT_IDX.lastUnderrunAtFrame, 1_024);
        Atomics.add(view, DROPOUT_IDX.bridgeDroppedBlocks, 7);

        dropoutCounters.reset();

        expect(dropoutCounters.read()).toEqual({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            lastUnderrunAtFrame: 0,
            bridgeDroppedBlocks: 0,
        });
        // Reset zeroes the shared buffer in place — the worklet keeps its view.
        expect(Atomics.load(view, DROPOUT_IDX.detectedUnderrunBlocks)).toBe(0);
    });
});

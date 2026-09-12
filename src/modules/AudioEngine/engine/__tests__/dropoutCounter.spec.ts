import { describe, it, expect, beforeEach, vi } from 'vitest';

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
        });
    });

    it('separates having no counter from counting zero', async () => {
        // A fresh module instance: the singleton under test has already been
        // handed its buffer by the cases around this one.
        vi.resetModules();
        const { dropoutCounters: unwired } = await import('../dropoutCounter');

        expect(unwired.hasCoverage()).toBe(false);
        expect(unwired.read().detectedUnderrunBlocks).toBe(0);

        // Handing the buffer out is not coverage: the worklet has been sent an
        // `init` it has not answered, and nothing is writing into the buffer yet.
        unwired.getSab();

        expect(unwired.hasCoverage()).toBe(false);

        unwired.openCoverage();

        expect(unwired.hasCoverage()).toBe(true);
    });

    it('holds coverage while any transport still counts and closes it with the last one', () => {
        dropoutCounters.openCoverage();
        dropoutCounters.openCoverage();

        dropoutCounters.closeCoverage();

        expect(dropoutCounters.hasCoverage()).toBe(true);

        dropoutCounters.closeCoverage();

        expect(dropoutCounters.hasCoverage()).toBe(false);
    });

    it('does not let an extra close hide the next transport that starts counting', () => {
        // A close with nothing open must clamp at zero. Were it allowed to go
        // negative, the next transport's open would leave the count at zero and
        // its dropouts would read as no coverage at all.
        dropoutCounters.closeCoverage();
        dropoutCounters.openCoverage();

        expect(dropoutCounters.hasCoverage()).toBe(true);

        dropoutCounters.closeCoverage();

        expect(dropoutCounters.hasCoverage()).toBe(false);
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

        dropoutCounters.reset();

        expect(dropoutCounters.read()).toEqual({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            lastUnderrunAtFrame: 0,
        });
        // Reset zeroes the shared buffer in place — the worklet keeps its view.
        expect(Atomics.load(view, DROPOUT_IDX.detectedUnderrunBlocks)).toBe(0);
    });
});

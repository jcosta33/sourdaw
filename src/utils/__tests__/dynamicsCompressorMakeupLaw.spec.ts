import { describe, expect, it } from 'vitest';

import {
    dynamicsCompressorHiddenMakeupDb,
    dynamicsCompressorHiddenMakeupGain,
    dynamicsCompressorStaticOutputDb,
    isCompressorAutoMakeupEngaged,
} from '../dynamicsCompressorMakeupLaw';

/**
 * With no knee the knee threshold is the threshold itself and the knee curve
 * is the identity up to it, so `Saturate(1)` lands on the ratio segment:
 * `T + (0 − T) / R` dB. The hidden makeup is 0.6 of its negation,
 * `0.6 · (−T) · (1 − 1/R)` dB, whatever `k` the bisection finds.
 */
function hardKneeMakeupDb(thresholdDb: number, ratio: number): number {
    return 0.6 * -thresholdDb * (1 - 1 / ratio);
}

describe('dynamicsCompressorHiddenMakeupDb', () => {
    it.each([
        [-40, 12],
        [-60, 20],
        [-20, 4],
        [-12, 2],
    ])('matches the hard-knee closed form at threshold %d dB, ratio %d', (thresholdDb, ratio) => {
        expect(dynamicsCompressorHiddenMakeupDb({ thresholdDb, kneeDb: 0, ratio })).toBeCloseTo(
            hardKneeMakeupDb(thresholdDb, ratio),
            4
        );
    });

    it('adds nothing at a 0 dB threshold with no knee, where Saturate(1) is 1', () => {
        expect(dynamicsCompressorHiddenMakeupGain({ thresholdDb: 0, kneeDb: 0, ratio: 4 })).toBe(1);
    });

    it('reproduces the figure Chromium renders at the descriptor defaults', () => {
        // Measured in compressorAutoMakeupRender.spec.ts: a -80 dBFS sine leaves
        // the uncompensated node 7.8515 dB louder.
        expect(dynamicsCompressorHiddenMakeupDb({ thresholdDb: -20, kneeDb: 6, ratio: 4 })).toBeCloseTo(7.8517, 3);
    });

    it('grows as the threshold falls and the ratio rises', () => {
        const gentle = dynamicsCompressorHiddenMakeupDb({ thresholdDb: -10, kneeDb: 6, ratio: 2 });
        const firm = dynamicsCompressorHiddenMakeupDb({ thresholdDb: -30, kneeDb: 6, ratio: 2 });
        const hard = dynamicsCompressorHiddenMakeupDb({ thresholdDb: -30, kneeDb: 6, ratio: 12 });
        expect(gentle).toBeGreaterThan(0);
        expect(firm).toBeGreaterThan(gentle);
        expect(hard).toBeGreaterThan(firm);
    });

    it("clamps to the node's nominal ranges the way the AudioParams do", () => {
        expect(dynamicsCompressorHiddenMakeupDb({ thresholdDb: -40, kneeDb: 0, ratio: 50 })).toBeCloseTo(
            hardKneeMakeupDb(-40, 20),
            4
        );
        expect(dynamicsCompressorHiddenMakeupDb({ thresholdDb: -150, kneeDb: 0, ratio: 20 })).toBeCloseTo(
            hardKneeMakeupDb(-100, 20),
            4
        );
    });
});

describe('dynamicsCompressorStaticOutputDb', () => {
    it('passes a level below the threshold unchanged', () => {
        expect(dynamicsCompressorStaticOutputDb({ thresholdDb: -20, kneeDb: 6, ratio: 4 }, -40)).toBeCloseTo(-40, 4);
    });

    it('follows the ratio above a hard knee', () => {
        expect(dynamicsCompressorStaticOutputDb({ thresholdDb: -40, kneeDb: 0, ratio: 12 }, -3)).toBeCloseTo(
            -40 + 37 / 12,
            4
        );
    });
});

describe('isCompressorAutoMakeupEngaged', () => {
    it.each([
        [undefined, true],
        [1, true],
        [0.6, true],
        [0, false],
        [0.4, false],
    ])('reads %s as %s', (stored, engaged) => {
        expect(isCompressorAutoMakeupEngaged(stored)).toBe(engaged);
    });
});

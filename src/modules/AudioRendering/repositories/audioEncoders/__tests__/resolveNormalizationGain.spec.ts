import { describe, expect, it } from 'vitest';

import { resolveNormalizationGain } from '../resolveNormalizationGain';

const CEILING_DB_TP = -1;
const TARGET_LUFS = -14;

function gainToDb(gain: number): number {
    return 20 * Math.log10(gain);
}

describe('resolveNormalizationGain', () => {
    it('raises a quiet mix by exactly the loudness shortfall', () => {
        const { gain, limitedByCeiling } = resolveNormalizationGain({
            integratedLufs: -20,
            truePeak: 0.1,
            targetLufs: TARGET_LUFS,
            ceilingDbTp: CEILING_DB_TP,
        });

        expect(gainToDb(gain)).toBeCloseTo(6, 6);
        expect(limitedByCeiling).toBe(false);
    });

    it('attenuates a mix that is louder than the target', () => {
        const { gain, limitedByCeiling } = resolveNormalizationGain({
            integratedLufs: -8,
            truePeak: 1,
            targetLufs: TARGET_LUFS,
            ceilingDbTp: CEILING_DB_TP,
        });

        expect(gainToDb(gain)).toBeCloseTo(-6, 6);
        expect(limitedByCeiling).toBe(false);
    });

    it('stops short of the loudness target rather than breaching the true-peak ceiling', () => {
        // Already at full scale but 6 dB under target: the loudness gain would
        // be +6 dB, which would reconstruct at +6 dBTP in the delivered file.
        const { gain, limitedByCeiling } = resolveNormalizationGain({
            integratedLufs: -20,
            truePeak: 1,
            targetLufs: TARGET_LUFS,
            ceilingDbTp: CEILING_DB_TP,
        });

        expect(gainToDb(gain)).toBeCloseTo(-1, 6);
        expect(limitedByCeiling).toBe(true);
    });

    it('pulls an over-ceiling mix down to the ceiling even when it is already loud enough', () => {
        // +2 dBTP of inter-sample overshoot at exactly the target loudness.
        const truePeak = Math.pow(10, 2 / 20);

        const { gain, limitedByCeiling } = resolveNormalizationGain({
            integratedLufs: TARGET_LUFS,
            truePeak,
            targetLufs: TARGET_LUFS,
            ceilingDbTp: CEILING_DB_TP,
        });

        expect(gainToDb(gain)).toBeCloseTo(-3, 6);
        expect(limitedByCeiling).toBe(true);
        // Applying the gain must land the peak exactly on the ceiling.
        expect(gainToDb(truePeak * gain)).toBeCloseTo(CEILING_DB_TP, 6);
    });

    it('leaves material with no measurable loudness untouched', () => {
        const { gain, limitedByCeiling } = resolveNormalizationGain({
            integratedLufs: null,
            truePeak: 0,
            targetLufs: TARGET_LUFS,
            ceilingDbTp: CEILING_DB_TP,
        });

        // Silence has no loudness to correct; any gain here would be arbitrary.
        expect(gain).toBe(1);
        expect(limitedByCeiling).toBe(false);
    });

    it('honours a stricter ceiling', () => {
        const { gain } = resolveNormalizationGain({
            integratedLufs: -20,
            truePeak: 1,
            targetLufs: TARGET_LUFS,
            ceilingDbTp: -3,
        });

        expect(gainToDb(gain)).toBeCloseTo(-3, 6);
    });
});

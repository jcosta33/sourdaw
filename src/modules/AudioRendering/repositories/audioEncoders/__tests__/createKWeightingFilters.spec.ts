import { describe, expect, it } from 'vitest';

import { createKWeightingFilters } from '../createKWeightingFilters';

/**
 * ITU-R BS.1770-4 published K-weighting filter coefficients at 48 kHz.
 * Source: Table 1 of the recommendation (shelf) and Table 2 (RLB high-pass).
 * The derivation in createKWeightingFilters must reproduce these exactly.
 */
const PUBLISHED_48K_SHELF = {
    b0: 1.535124659125,
    b1: -2.691696189406,
    b2: 1.198392810852,
    a1: -1.690659293182,
    a2: 0.732480774215,
};

const PUBLISHED_48K_HIGHPASS = {
    b0: 1.0,
    b1: -2.0,
    b2: 1.0,
    a1: -1.990047454833,
    a2: 0.990072250366,
};

describe('createKWeightingFilters', () => {
    it('reproduces the ITU-R BS.1770-4 shelf coefficients at 48 kHz', () => {
        const { shelf } = createKWeightingFilters(48000);

        expect(shelf.b0).toBeCloseTo(PUBLISHED_48K_SHELF.b0, 6);
        expect(shelf.b1).toBeCloseTo(PUBLISHED_48K_SHELF.b1, 6);
        expect(shelf.b2).toBeCloseTo(PUBLISHED_48K_SHELF.b2, 6);
        expect(shelf.a1).toBeCloseTo(PUBLISHED_48K_SHELF.a1, 6);
        expect(shelf.a2).toBeCloseTo(PUBLISHED_48K_SHELF.a2, 6);
    });

    it('reproduces the ITU-R BS.1770-4 RLB high-pass coefficients at 48 kHz', () => {
        const { highPass } = createKWeightingFilters(48000);

        expect(highPass.b0).toBeCloseTo(PUBLISHED_48K_HIGHPASS.b0, 6);
        expect(highPass.b1).toBeCloseTo(PUBLISHED_48K_HIGHPASS.b1, 6);
        expect(highPass.b2).toBeCloseTo(PUBLISHED_48K_HIGHPASS.b2, 6);
        expect(highPass.a1).toBeCloseTo(PUBLISHED_48K_HIGHPASS.a1, 6);
        expect(highPass.a2).toBeCloseTo(PUBLISHED_48K_HIGHPASS.a2, 6);
    });

    it('derives different coefficients at 44.1 kHz (not reusing 48 kHz values)', () => {
        const at44k = createKWeightingFilters(44100);
        const at48k = createKWeightingFilters(48000);

        // The shelf b0 must differ between sample rates — the whole point of
        // deriving coefficients per-rate rather than hardcoding 48 kHz values.
        expect(at44k.shelf.b0).not.toBeCloseTo(at48k.shelf.b0, 6);
        expect(at44k.highPass.a1).not.toBeCloseTo(at48k.highPass.a1, 6);
    });

    it('the high-pass b-coefficients are always [1, -2, 1] regardless of sample rate', () => {
        // The RLB filter is a standard second-order high-pass whose numerator
        // is the constant [1, -2, 1]; only the denominator changes with rate.
        for (const sr of [44100, 48000, 96000]) {
            const { highPass } = createKWeightingFilters(sr);
            expect(highPass.b0).toBe(1);
            expect(highPass.b1).toBe(-2);
            expect(highPass.b2).toBe(1);
        }
    });

    it('produces stable filter coefficients (denominator roots inside unit circle)', () => {
        // Stability check: for a second-order section with normalised a0=1,
        // |a2| < 1 and |a1| < 1 + a2 must both hold.
        for (const sr of [44100, 48000, 96000]) {
            const { shelf, highPass } = createKWeightingFilters(sr);
            for (const stage of [shelf, highPass]) {
                expect(Math.abs(stage.a2)).toBeLessThan(1);
                expect(Math.abs(stage.a1)).toBeLessThan(1 + stage.a2);
            }
        }
    });
});

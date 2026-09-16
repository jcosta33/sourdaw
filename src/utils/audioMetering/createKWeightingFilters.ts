export type LoudnessBiquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

export type KWeightingFilters = {
    /** Stage 1: high-frequency shelf modelling the head. */
    shelf: LoudnessBiquad;
    /** Stage 2: RLB high-pass. */
    highPass: LoudnessBiquad;
};

// ITU-R BS.1770-4 Table 1, verbatim: the K-weighting shelf and RLB high-pass
// parameters the biquad derivation below consumes. Seventeen significant
// digits each — any rounding here shifts the measured loudness.
const SHELF_F0_HZ = 1681.974450955533;
const SHELF_GAIN_DB = 3.999843853973347;
const SHELF_Q = 0.7071752369554196;
const SHELF_VB_EXPONENT = 0.4996667741545416;
const HIGH_PASS_F0_HZ = 38.13547087602444;
const HIGH_PASS_Q = 0.5003270373238773;

/**
 * K-weighting pre-filter for loudness measurement — ITU-R BS.1770-4.
 *
 * The biquads are derived from the recommendation's filter parameters at the
 * actual sample rate rather than transcribed at 48 kHz and reused. Export runs
 * at 44.1 kHz by default, and reusing the 48 kHz coefficients there shifts both
 * the shelf and the high-pass corner, biasing every reading. A spec asserts
 * that at 48 kHz this derivation reproduces the published coefficients exactly.
 */
export function createKWeightingFilters(sampleRate: number): KWeightingFilters {
    const shelfK = Math.tan((Math.PI * SHELF_F0_HZ) / sampleRate);
    const vh = 10 ** (SHELF_GAIN_DB / 20);
    const vb = vh ** SHELF_VB_EXPONENT;
    const shelfDenominator = 1 + shelfK / SHELF_Q + shelfK * shelfK;

    const highPassK = Math.tan((Math.PI * HIGH_PASS_F0_HZ) / sampleRate);
    const highPassDenominator = 1 + highPassK / HIGH_PASS_Q + highPassK * highPassK;

    return {
        shelf: {
            b0: (vh + (vb * shelfK) / SHELF_Q + shelfK * shelfK) / shelfDenominator,
            b1: (2 * (shelfK * shelfK - vh)) / shelfDenominator,
            b2: (vh - (vb * shelfK) / SHELF_Q + shelfK * shelfK) / shelfDenominator,
            a1: (2 * (shelfK * shelfK - 1)) / shelfDenominator,
            a2: (1 - shelfK / SHELF_Q + shelfK * shelfK) / shelfDenominator,
        },
        highPass: {
            b0: 1,
            b1: -2,
            b2: 1,
            a1: (2 * (highPassK * highPassK - 1)) / highPassDenominator,
            a2: (1 - highPassK / HIGH_PASS_Q + highPassK * highPassK) / highPassDenominator,
        },
    };
}

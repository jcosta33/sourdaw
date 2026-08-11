import { describe, expect, it } from 'vitest';

import {
    DECAY_MAX,
    MAX_IR_STRETCH,
    MAX_RT60_SECONDS,
    MIN_IR_STRETCH,
    MIN_RT60_SECONDS,
    decayToIrStretch,
    decayToRt60Seconds,
    rt60SecondsToDecay,
} from '#/utils/reverbDecayLaw';

import { NATIVE_DSP_DESCRIPTORS } from '../NativeDspDescriptors';

/**
 * Pins the declared `dutch-oven` Decay range to the tail each engine actually
 * produces from it.
 *
 * The defect this guards: the descriptor declares `decay` as a unitless 0…0.999
 * coefficient, but the FDN read the incoming value as an RT60 in seconds and
 * clamped it to 0.1…30 s. The whole declared range therefore collapsed into an
 * RT60 of 0.1…1.0 s — the Dutch Oven could not produce a tail longer than about
 * a second, and the top of the knob did nothing. These assertions fail if the
 * descriptor range and the conversion law are ever changed apart from each
 * other, in either direction.
 *
 * The Rust half of the same contract is pinned in
 * `crates/proof-chamber/src/{decay_curve,fdn}.rs`.
 */
describe('dutch-oven decay contract', () => {
    const dutchOven = NATIVE_DSP_DESCRIPTORS.find((descriptor) => descriptor.id === 'dutch-oven');
    const decay = dutchOven?.parameters.find((param) => param.id === 'decay');

    it('declares decay as a unitless coefficient, not a duration', () => {
        expect(decay?.unit).toBe('');
        expect(decay?.minValue).toBe(0);
        expect(decay?.maxValue).toBe(DECAY_MAX);
        expect(decay?.defaultValue).toBe(0.5);
    });

    it('versions the corrected FDN damping curve only on newly added devices', () => {
        expect(dutchOven?.internalParameterValues).toEqual({ fdn_damping_version: 2 });
        expect(dutchOven?.parameters.some((parameter) => parameter.id === 'fdn_damping_version')).toBe(false);
    });

    it('maps the declared range onto the full RT60 the FDN can realise', () => {
        expect(decayToRt60Seconds(decay?.minValue ?? Number.NaN)).toBeCloseTo(MIN_RT60_SECONDS, 4);
        expect(decayToRt60Seconds(decay?.defaultValue ?? Number.NaN)).toBeCloseTo(1.732, 3);
        expect(decayToRt60Seconds(decay?.maxValue ?? Number.NaN)).toBeCloseTo(29.829, 3);
    });

    it('reaches a long tail at the top of the declared range', () => {
        // Regression: the raw-seconds reading capped this at 0.999 s.
        const longest = decayToRt60Seconds(decay?.maxValue ?? Number.NaN);
        expect(longest).toBeGreaterThan(25);
        expect(longest).toBeLessThanOrEqual(MAX_RT60_SECONDS);
    });

    it('gives the convolution engine the same knob a neutral centre', () => {
        expect(decayToIrStretch(decay?.minValue ?? Number.NaN)).toBeCloseTo(MIN_IR_STRETCH, 5);
        expect(decayToIrStretch(decay?.defaultValue ?? Number.NaN)).toBeCloseTo(1, 5);
        expect(decayToIrStretch(decay?.maxValue ?? Number.NaN)).toBeGreaterThan(3.98);
        expect(decayToIrStretch(decay?.maxValue ?? Number.NaN)).toBeLessThanOrEqual(MAX_IR_STRETCH);
    });

    it('keeps every stored value in the declared range mapped monotonically', () => {
        const min = decay?.minValue ?? Number.NaN;
        const max = decay?.maxValue ?? Number.NaN;
        let previousRt60 = 0;
        let previousStretch = 0;

        for (let step = 0; step <= 100; step += 1) {
            const stored = min + ((max - min) * step) / 100;
            const rt60 = decayToRt60Seconds(stored);
            const stretch = decayToIrStretch(stored);

            expect(rt60).toBeGreaterThan(previousRt60);
            expect(stretch).toBeGreaterThan(previousStretch);
            previousRt60 = rt60;
            previousStretch = stretch;
        }
    });

    it('round-trips a wanted RT60 back to a value inside the declared range', () => {
        const stored = rt60SecondsToDecay(4);

        expect(stored).toBeGreaterThanOrEqual(decay?.minValue ?? Number.NaN);
        expect(stored).toBeLessThanOrEqual(decay?.maxValue ?? Number.NaN);
        expect(decayToRt60Seconds(stored)).toBeCloseTo(4, 5);
    });
});

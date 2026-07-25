import { describe, expect, it } from 'vitest';

import {
    DECAY_DEFAULT,
    DECAY_MAX,
    MAX_IR_STRETCH,
    MAX_RT60_SECONDS,
    MIN_IR_STRETCH,
    MIN_RT60_SECONDS,
    decayToIrStretch,
    decayToRt60Seconds,
    rt60SecondsToDecay,
} from '../reverbDecayLaw';

/**
 * The TypeScript half of the Dutch Oven `decay` law. The expected numbers here
 * are the same ones asserted in `crates/proof-chamber/src/decay_curve.rs`; the
 * panel readout and the Rust engines must agree on them or the knob lies about
 * the tail it produces.
 */
describe('reverbDecayLaw', () => {
    describe('decayToRt60Seconds', () => {
        it('spans the realisable RT60 window across the declared decay range', () => {
            expect(decayToRt60Seconds(0)).toBeCloseTo(MIN_RT60_SECONDS, 6);
            expect(decayToRt60Seconds(DECAY_DEFAULT)).toBeCloseTo(1.7320508, 6);
            expect(decayToRt60Seconds(DECAY_MAX)).toBeCloseTo(29.8294, 3);
            expect(decayToRt60Seconds(1)).toBeCloseTo(MAX_RT60_SECONDS, 6);
        });

        it('spends equal knob travel on an equal ratio of tail length', () => {
            const lowerRatio = decayToRt60Seconds(0.5) / decayToRt60Seconds(0.25);
            const upperRatio = decayToRt60Seconds(0.75) / decayToRt60Seconds(0.5);

            expect(lowerRatio).toBeCloseTo(upperRatio, 6);
        });

        it('clamps rather than extrapolating outside the range', () => {
            expect(decayToRt60Seconds(-4)).toBeCloseTo(MIN_RT60_SECONDS, 6);
            expect(decayToRt60Seconds(12)).toBeCloseTo(MAX_RT60_SECONDS, 6);
        });
    });

    describe('decayToIrStretch', () => {
        it('leaves a loaded IR at its natural length on the default', () => {
            expect(decayToIrStretch(DECAY_DEFAULT)).toBeCloseTo(1, 6);
        });

        it('spans the stretch window the convolution engine accepts', () => {
            expect(decayToIrStretch(0)).toBeCloseTo(MIN_IR_STRETCH, 6);
            expect(decayToIrStretch(1)).toBeCloseTo(MAX_IR_STRETCH, 6);
            expect(decayToIrStretch(DECAY_MAX)).toBeGreaterThan(3.98);
        });

        it('clamps rather than extrapolating outside the range', () => {
            expect(decayToIrStretch(-4)).toBeCloseTo(MIN_IR_STRETCH, 6);
            expect(decayToIrStretch(12)).toBeCloseTo(MAX_IR_STRETCH, 6);
        });
    });

    describe('rt60SecondsToDecay', () => {
        it('inverts decayToRt60Seconds across the range', () => {
            for (const stored of [0, 0.25, DECAY_DEFAULT, 0.75, DECAY_MAX]) {
                expect(rt60SecondsToDecay(decayToRt60Seconds(stored))).toBeCloseTo(stored, 6);
            }
        });

        it('pins unrealisable tail requests to the ends of the stored range', () => {
            expect(rt60SecondsToDecay(0)).toBe(0);
            expect(rt60SecondsToDecay(120)).toBe(1);
        });
    });
});

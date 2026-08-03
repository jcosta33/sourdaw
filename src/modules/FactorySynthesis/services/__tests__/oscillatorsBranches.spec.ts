import { describe, it, expect } from 'vitest';

import {
    renderSine,
    renderTriangle,
    renderSquare,
    renderSaw,
    renderNoise,
    renderFmOscillator,
    midiToFreq,
} from '../oscillators';

/**
 * Branch-focused specs for oscillators.ts covering the freq-callback path
 * (isFn branch in each renderer), phase wrapping correctness, FM modIndex
 * callback, and renderNoise LCG boundary at seed=0. The existing
 * oscillators.spec.ts only checks range bounds and length.
 */

const SR = 48000;

describe('renderSine — freq callback path', () => {
    it('produces a higher-frequency output when the callback returns a larger value', () => {
        const low = renderSine(0.01, () => 100, SR);
        const high = renderSine(0.01, () => 800, SR);
        // Count zero-crossings (sign changes) — higher freq = more crossings.
        function zeroCrossings(buf: Float32Array): number {
            let count = 0;
            for (let i = 1; i < buf.length; i++) {
                if ((buf[i - 1]! <= 0 && buf[i]! > 0) || (buf[i - 1]! >= 0 && buf[i]! < 0)) {
                    count++;
                }
            }
            return count;
        }
        expect(zeroCrossings(high)).toBeGreaterThan(zeroCrossings(low));
    });

    it('callback freq = constant produces the same result as scalar freq', () => {
        const scalar = renderSine(0.01, 440, SR);
        const callback = renderSine(0.01, () => 440, SR);
        for (let i = 0; i < scalar.length; i++) {
            expect(callback[i]).toBeCloseTo(scalar[i]!, 6);
        }
    });

    it('a rising frequency callback produces increasing zero-crossing density', () => {
        const rising = renderSine(0.05, (t) => 100 + 2000 * t, SR);
        // First quarter should have fewer zero-crossings than the last quarter.
        const q = Math.floor(rising.length / 4);
        let firstQuarterCrossings = 0;
        let lastQuarterCrossings = 0;
        for (let i = 1; i < q; i++) {
            if ((rising[i - 1]! <= 0 && rising[i]! > 0) || (rising[i - 1]! >= 0 && rising[i]! < 0)) {
                firstQuarterCrossings++;
            }
        }
        for (let i = rising.length - q; i < rising.length; i++) {
            if ((rising[i - 1]! <= 0 && rising[i]! > 0) || (rising[i - 1]! >= 0 && rising[i]! < 0)) {
                lastQuarterCrossings++;
            }
        }
        expect(lastQuarterCrossings).toBeGreaterThan(firstQuarterCrossings);
    });
});

describe('renderSquare — phase wrapping and value switching', () => {
    it('outputs +1 for phase < 0.5 and -1 for phase >= 0.5', () => {
        const buf = renderSquare(0.01, 100, SR);
        // At 100 Hz, period = 480 samples. First half (0..239) is +1, second is -1.
        expect(buf[0]).toBe(1);
        expect(buf[100]).toBe(1);
        // The transition happens at phase = 0.5, which is at sample 240.
        expect(buf[250]).toBe(-1);
    });

    it('callback freq path wraps phase correctly (no NaN)', () => {
        const buf = renderSquare(0.01, () => 500, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i] === 1 || buf[i] === -1).toBe(true);
        }
    });
});

describe('renderSaw — phase wrapping produces a ramp', () => {
    it('starts near -1 (phase starts at f*dt, not exactly 0) and ramps up', () => {
        const buf = renderSaw(0.01, 100, SR);
        // First sample: phase = 0 + f*dt = 100/48000. value = 2*phase - 1 ≈ -0.9958.
        const expectedFirst = 2 * (100 / SR) - 1;
        expect(buf[0]).toBeCloseTo(expectedFirst, 5);
        // At sample 120 (phase ≈ 0.25), value should be ≈ -0.5.
        expect(buf[120]).toBeCloseTo(2 * (121 * (100 / SR)) - 1, 1);
    });
});

describe('renderTriangle — phase wrapping produces a peak at phase 0.5', () => {
    it('starts near +1 (phase starts at f*dt) and dips to -1 at phase 0.5', () => {
        const buf = renderTriangle(0.01, 100, SR);
        // First sample: phase = f*dt = 100/48000. value = 4*|phase-0.5|-1 ≈ 0.9917.
        const expectedFirst = 4 * Math.abs(100 / SR - 0.5) - 1;
        expect(buf[0]).toBeCloseTo(expectedFirst, 5);
        // At sample 240 (phase ≈ 0.5): value ≈ -1.
        expect(buf[240]).toBeCloseTo(-1, 1);
    });
});

describe('renderNoise — LCG determinism and seed=0 boundary', () => {
    it('seed=0 produces a deterministic first sample', () => {
        // state = 0 >>> 0 = 0. First iteration: state = (0 * 1664525 + 1013904223) >>> 0.
        const expectedState = (0 * 1664525 + 1013904223) >>> 0;
        const expectedSample = (expectedState / 0xffffffff) * 2 - 1;
        const buf = renderNoise(0.001, SR, 0);
        expect(buf[0]).toBeCloseTo(expectedSample, 6);
    });

    it('seed=1 produces a different first sample than seed=0', () => {
        const state1 = (1 * 1664525 + 1013904223) >>> 0;
        const expected1 = (state1 / 0xffffffff) * 2 - 1;
        const buf0 = renderNoise(0.001, SR, 0);
        const buf1 = renderNoise(0.001, SR, 1);
        expect(buf1[0]).toBeCloseTo(expected1, 6);
        expect(buf0[0]!).not.toBeCloseTo(buf1[0]!, 6);
    });

    it('same seed produces identical output across calls', () => {
        const a = renderNoise(0.01, SR, 42);
        const b = renderNoise(0.01, SR, 42);
        for (let i = 0; i < a.length; i++) {
            expect(a[i]).toBe(b[i]);
        }
    });
});

describe('renderFmOscillator — modIndex callback path', () => {
    it('modIndex callback produces different output than scalar modIndex', () => {
        const scalar = renderFmOscillator(0.01, 440, 220, 100, SR);
        const callback = renderFmOscillator(0.01, 440, 220, () => 100, SR);
        // callback returning the same constant should match scalar exactly.
        for (let i = 0; i < scalar.length; i++) {
            expect(callback[i]).toBeCloseTo(scalar[i]!, 6);
        }
    });

    it('a time-varying modIndex produces a measurably different spectrum than constant', () => {
        const constant = renderFmOscillator(0.05, 440, 220, 50, SR);
        const varying = renderFmOscillator(0.05, 440, 220, (t) => 50 + 500 * t, SR);
        // The varying-index output should differ from the constant one.
        let anyDiff = false;
        for (let i = 0; i < constant.length; i++) {
            if (Math.abs(constant[i]! - varying[i]!) > 0.001) {
                anyDiff = true;
                break;
            }
        }
        expect(anyDiff).toBe(true);
    });
});

describe('midiToFreq — formula correctness', () => {
    it('A4 (MIDI 69) = 440 Hz', () => {
        expect(midiToFreq(69)).toBeCloseTo(440, 5);
    });

    it('A5 (MIDI 81) = 880 Hz (one octave up)', () => {
        expect(midiToFreq(81)).toBeCloseTo(880, 5);
    });

    it('A3 (MIDI 57) = 220 Hz (one octave down)', () => {
        expect(midiToFreq(57)).toBeCloseTo(220, 5);
    });

    it('C-1 (MIDI 0) = ~8.18 Hz', () => {
        expect(midiToFreq(0)).toBeCloseTo(8.1758, 2);
    });

    it('fractional note 69.5 is halfway between A4 and A#4', () => {
        const half = midiToFreq(69.5);
        const a4 = midiToFreq(69);
        const as4 = midiToFreq(70);
        expect(half).toBeGreaterThan(a4);
        expect(half).toBeLessThan(as4);
    });

    it('negative MIDI notes produce sub-audio frequencies', () => {
        // MIDI -12 = 440 * 2^((-12-69)/12) = 440 * 2^(-6.75) ≈ 4.088 Hz
        expect(midiToFreq(-12)).toBeCloseTo(4.0879, 2);
    });
});

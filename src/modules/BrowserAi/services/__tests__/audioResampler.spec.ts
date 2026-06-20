import { describe, it, expect } from 'vitest';

import { normalizePeak, midiToHz, velocityToDb } from '../audioResampler';

describe('normalizePeak', () => {
    it('scales the buffer so the peak magnitude becomes 1', () => {
        const audio = new Float32Array([0.25, -0.5, 0.1]);
        normalizePeak(audio);
        expect(audio[1]).toBeCloseTo(-1, 6);
        expect(audio[0]).toBeCloseTo(0.5, 6);
        expect(audio[2]).toBeCloseTo(0.2, 6);
    });

    it('leaves a buffer already peaking at 1 untouched', () => {
        const audio = new Float32Array([1, -0.5, 0.25]);
        normalizePeak(audio);
        expect(Array.from(audio)).toEqual([1, -0.5, 0.25]);
    });

    // Regression: a NaN sample fails the `abs > peak` comparison (NaN compares
    // false), so peak stayed 0, normalization was skipped, and the NaN survived
    // into the rendered audio. NaN/±Infinity must now be clamped to 0 and the
    // remaining finite samples normalized against the real peak.
    it('clamps NaN samples to 0 and still normalizes the finite samples', () => {
        const audio = new Float32Array([NaN, 0.5, -0.25]);
        normalizePeak(audio);

        expect(audio[0]).toBe(0);
        // peak of the finite samples is 0.5 -> scale by 2.
        expect(audio[1]).toBeCloseTo(1, 6);
        expect(audio[2]).toBeCloseTo(-0.5, 6);
        expect(Array.from(audio).every((value) => Number.isFinite(value))).toBe(true);
    });

    it('clamps +Infinity and -Infinity samples to 0', () => {
        const audio = new Float32Array([Infinity, -Infinity, 0.4]);
        normalizePeak(audio);

        expect(audio[0]).toBe(0);
        expect(audio[1]).toBe(0);
        // Only finite sample is 0.4 -> normalized to 1.
        expect(audio[2]).toBeCloseTo(1, 6);
        expect(Array.from(audio).every((value) => Number.isFinite(value))).toBe(true);
    });

    it('zeroes non-finite samples even when no scaling is required (peak already 1)', () => {
        const audio = new Float32Array([1, NaN, -0.3]);
        normalizePeak(audio);
        expect(audio[1]).toBe(0);
        expect(audio[0]).toBe(1);
        expect(audio[2]).toBeCloseTo(-0.3, 6);
    });
});

describe('midiToHz', () => {
    it('maps MIDI 69 (A4) to 440 Hz', () => {
        expect(midiToHz(69)).toBeCloseTo(440, 6);
    });
});

describe('velocityToDb', () => {
    it('returns -120 dB for velocity 0', () => {
        expect(velocityToDb(0)).toBe(-120);
    });
    it('returns 0 dB for max velocity 127', () => {
        expect(velocityToDb(127)).toBeCloseTo(0, 6);
    });
});

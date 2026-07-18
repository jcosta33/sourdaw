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

const SR = 48000;

describe('renderSine', () => {
    it('produces correct length for duration', () => {
        const buf = renderSine(0.1, 440, SR);
        expect(buf.length).toBe(Math.round(0.1 * SR));
    });

    it('values are in -1 to 1 range', () => {
        const buf = renderSine(0.5, 220, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i]).toBeGreaterThanOrEqual(-1.001);
            expect(buf[i]).toBeLessThanOrEqual(1.001);
        }
    });

    it('accepts frequency function', () => {
        const buf = renderSine(0.1, (t) => 200 + 200 * t, SR);
        expect(buf.length).toBe(Math.round(0.1 * SR));
    });

    it('zero frequency produces DC at 0', () => {
        const buf = renderSine(0.01, 0, SR);
        expect(Math.abs(buf[50]!)).toBeLessThan(0.001);
    });
});

describe('renderTriangle', () => {
    it('values are in -1 to 1 range', () => {
        const buf = renderTriangle(0.1, 440, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i]).toBeGreaterThanOrEqual(-1.001);
            expect(buf[i]).toBeLessThanOrEqual(1.001);
        }
    });
});

describe('renderSquare', () => {
    it('values are exactly +1 or -1', () => {
        const buf = renderSquare(0.1, 440, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(Math.abs(buf[i]!)).toBeCloseTo(1, 1);
        }
    });
});

describe('renderSaw', () => {
    it('values are in -1 to 1 range', () => {
        const buf = renderSaw(0.1, 440, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i]).toBeGreaterThanOrEqual(-1.001);
            expect(buf[i]).toBeLessThanOrEqual(1.001);
        }
    });
});

describe('renderNoise', () => {
    it('values are in -1 to 1 range', () => {
        const buf = renderNoise(0.1, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i]).toBeGreaterThanOrEqual(-1.001);
            expect(buf[i]).toBeLessThanOrEqual(1.001);
        }
    });

    it('is deterministic with same seed', () => {
        const a = renderNoise(0.01, SR, 42);
        const b = renderNoise(0.01, SR, 42);
        expect(Array.from(a)).toEqual(Array.from(b));
    });

    it('different seed produces different output', () => {
        const a = renderNoise(0.01, SR, 1);
        const b = renderNoise(0.01, SR, 2);
        expect(Array.from(a)).not.toEqual(Array.from(b));
    });
});

describe('renderFmOscillator', () => {
    it('values are in -1 to 1 range', () => {
        const buf = renderFmOscillator(0.1, 440, 220, 100, SR);
        for (let i = 0; i < buf.length; i++) {
            expect(buf[i]).toBeGreaterThanOrEqual(-1.001);
            expect(buf[i]).toBeLessThanOrEqual(1.001);
        }
    });

    it('accepts modIndex function', () => {
        const buf = renderFmOscillator(0.1, 440, 220, (t) => 100 * t, SR);
        expect(buf.length).toBe(Math.round(0.1 * SR));
    });
});

describe('midiToFreq', () => {
    it('A4 (MIDI 69) = 440 Hz', () => {
        expect(midiToFreq(69)).toBeCloseTo(440, 1);
    });
    it('C5 (MIDI 72) ≈ 523 Hz', () => {
        expect(midiToFreq(72)).toBeCloseTo(523.25, 0);
    });
    it('A3 (MIDI 57) = 220 Hz', () => {
        expect(midiToFreq(57)).toBeCloseTo(220, 1);
    });
    it('MIDI 0 ≈ 8.18 Hz', () => {
        expect(midiToFreq(0)).toBeCloseTo(8.18, 1);
    });
});

import { describe, it, expect } from 'vitest';

import { resampleLinear } from '../resampleLinear';

describe('resampleLinear', () => {
    it('returns the same buffer instance unchanged when rates match', () => {
        const input = new Float32Array([0, 0.5, -0.5, 1]);
        const out = resampleLinear(input, 48000, 48000);
        expect(out).toBe(input);
    });

    it('shortens a 48 kHz buffer to the 44.1 kHz engine rate by the rate ratio', () => {
        // 441 frames at 48 kHz → round(441 * 44100/48000) = round(405.16) = 405.
        const input = new Float32Array(441);
        const out = resampleLinear(input, 48000, 44100);
        expect(out).not.toBe(input);
        expect(out.length).toBe(Math.round(441 * (44100 / 48000)));
        expect(out.length).toBe(405);
    });

    it('lengthens a 44.1 kHz buffer to a 48 kHz engine rate by the rate ratio', () => {
        // 405 frames at 44.1 kHz → round(405 * 48000/44100) = round(440.81) = 441.
        const input = new Float32Array(405);
        const out = resampleLinear(input, 44100, 48000);
        expect(out.length).toBe(Math.round(405 * (48000 / 44100)));
        expect(out.length).toBe(441);
    });

    it('halves the length when downsampling by exactly 2x', () => {
        const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]);
        const out = resampleLinear(input, 48000, 24000);
        expect(out.length).toBe(4);
        // Output frame i samples source position i / ratio = i * 2 exactly,
        // so each output frame lands on an integer source index (no interp error).
        expect(Array.from(out)).toEqual([0, 2, 4, 6]);
    });

    it('linearly interpolates between source frames when upsampling 2x', () => {
        const input = new Float32Array([0, 10]);
        const out = resampleLinear(input, 24000, 48000);
        // ratio = 2 → 4 output frames at source positions 0, 0.5, 1.0, 1.5.
        // Position 1.5 clamps its high tap to the last index (1), giving 10.
        expect(out.length).toBe(4);
        expect(out[0]).toBeCloseTo(0, 6);
        expect(out[1]).toBeCloseTo(5, 6);
        expect(out[2]).toBeCloseTo(10, 6);
        expect(out[3]).toBeCloseTo(10, 6);
    });

    it('clamps the trailing tap so the last output frame never reads past the source', () => {
        // Upsampling pushes the final source position beyond the last index;
        // bounds-safe clamping must keep the output finite (no NaN/undefined).
        const input = new Float32Array([1, 2, 3]);
        const out = resampleLinear(input, 40000, 48000);
        const last = out[out.length - 1];
        expect(Number.isFinite(last)).toBe(true);
        for (const value of out) {
            expect(Number.isFinite(value)).toBe(true);
        }
    });

    it('returns the input unchanged for empty or single-frame buffers', () => {
        const empty = new Float32Array(0);
        expect(resampleLinear(empty, 48000, 44100)).toBe(empty);
        const single = new Float32Array([0.25]);
        expect(resampleLinear(single, 48000, 44100)).toBe(single);
    });

    it('is a defensive no-op for non-finite or non-positive rates', () => {
        const input = new Float32Array([0, 1, 2]);
        expect(resampleLinear(input, 0, 48000)).toBe(input);
        expect(resampleLinear(input, 48000, 0)).toBe(input);
        expect(resampleLinear(input, Number.NaN, 48000)).toBe(input);
        expect(resampleLinear(input, 48000, Number.POSITIVE_INFINITY)).toBe(input);
        expect(resampleLinear(input, -48000, 44100)).toBe(input);
    });
});

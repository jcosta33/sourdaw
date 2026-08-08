import { describe, expect, it } from 'vitest';

import { mixMono, mixMonoIntoStereo } from '../mixing';

describe('mixMono', () => {
    it('adds src × gain into dst element-wise', () => {
        const dst = new Float32Array([1, 2, 3, 4]);
        const src = new Float32Array([10, 20, 30, 40]);

        mixMono(dst, src, 0.5);

        // dst[i] += src[i] * 0.5
        expect(Array.from(dst)).toEqual([6, 12, 18, 24]);
    });

    it('offsets the source into the destination by offsetSamples', () => {
        const dst = new Float32Array([0, 0, 0, 0, 0]);
        const src = new Float32Array([1, 2, 3]);

        mixMono(dst, src, 1, 2);

        // src[0]→dst[2], src[1]→dst[3], src[2]→dst[4].
        expect(Array.from(dst)).toEqual([0, 0, 1, 2, 3]);
    });

    it('clamps to the destination length when the source extends past it', () => {
        const dst = new Float32Array([0, 0, 0]);
        const src = new Float32Array([1, 2, 3, 4, 5]);

        mixMono(dst, src, 1);

        expect(Array.from(dst)).toEqual([1, 2, 3]);
    });

    it('clamps to a non-negative start when offset is negative', () => {
        const dst = new Float32Array([0, 0, 0, 0]);
        const src = new Float32Array([1, 2, 3, 4, 5]);

        // offset -2: loop starts at max(0, -2) = 0, src[i - (-2)] = src[i+2].
        mixMono(dst, src, 1, -2);

        // dst[0] += src[2], dst[1] += src[3], dst[2] += src[4].
        expect(Array.from(dst)).toEqual([3, 4, 5, 0]);
    });

    it('with gain 0 leaves the destination unchanged', () => {
        const dst = new Float32Array([7, 8, 9]);
        const src = new Float32Array([1, 2, 3]);

        mixMono(dst, src, 0);

        expect(Array.from(dst)).toEqual([7, 8, 9]);
    });
});

describe('mixMonoIntoStereo', () => {
    it('applies equal-power panning: centre (pan=0) splits equally L/R', () => {
        const dst: [Float32Array, Float32Array] = [new Float32Array(2), new Float32Array(2)];
        const src = new Float32Array([1, 1]);

        mixMonoIntoStereo(dst, src, 1, 0);

        // pan=0: leftGain = cos(PI/4) ≈ 0.7071, rightGain = sin(PI/4) ≈ 0.7071.
        expect(dst[0][0]).toBeCloseTo(Math.SQRT1_2, 5);
        expect(dst[1][0]).toBeCloseTo(Math.SQRT1_2, 5);
    });

    it('applies equal-power panning: hard left (pan=-1) sends all to L, none to R', () => {
        const dst: [Float32Array, Float32Array] = [new Float32Array(1), new Float32Array(1)];
        const src = new Float32Array([1]);

        mixMonoIntoStereo(dst, src, 1, -1);

        // pan=-1: leftGain = cos(0) = 1, rightGain = sin(0) = 0.
        expect(dst[0][0]).toBeCloseTo(1, 5);
        expect(dst[1][0]).toBeCloseTo(0, 5);
    });

    it('applies equal-power panning: hard right (pan=1) sends all to R, none to L', () => {
        const dst: [Float32Array, Float32Array] = [new Float32Array(1), new Float32Array(1)];
        const src = new Float32Array([1]);

        mixMonoIntoStereo(dst, src, 1, 1);

        // pan=1: leftGain = cos(PI/2) ≈ 0, rightGain = sin(PI/2) = 1.
        expect(dst[0][0]).toBeCloseTo(0, 5);
        expect(dst[1][0]).toBeCloseTo(1, 5);
    });

    it('multiplies by gain before panning', () => {
        const dst: [Float32Array, Float32Array] = [new Float32Array(1), new Float32Array(1)];
        const src = new Float32Array([1]);

        mixMonoIntoStereo(dst, src, 0.5, 0);

        // gain 0.5, pan centre: 0.5 * cos(PI/4) ≈ 0.3536.
        expect(dst[0][0]).toBeCloseTo(0.5 * Math.SQRT1_2, 5);
        expect(dst[1][0]).toBeCloseTo(0.5 * Math.SQRT1_2, 5);
    });

    it('respects offsetSamples and clamps to destination length', () => {
        const dst: [Float32Array, Float32Array] = [new Float32Array(4), new Float32Array(4)];
        const src = new Float32Array([1, 2, 3, 4, 5]);

        mixMonoIntoStereo(dst, src, 1, 0, 2);

        // src[0]→dst[2], src[1]→dst[3]; src[2..4] clipped.
        expect(dst[0][0]).toBe(0);
        expect(dst[0][1]).toBe(0);
        expect(dst[0][2]).toBeCloseTo(Math.SQRT1_2, 5);
        expect(dst[0][3]).toBeCloseTo(2 * Math.SQRT1_2, 5);
        expect(dst[1][2]).toBeCloseTo(Math.SQRT1_2, 5);
    });
});

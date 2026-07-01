import { describe, it, expect } from 'vitest';

import { makeBitcrusherCurve } from '../makeBitcrusherCurve';
import { makeDistortionCurve } from '../makeDistortionCurve';

describe('makeDistortionCurve', () => {
    it('should build a tanh waveshaper curve of fixed length', () => {
        const curve = makeDistortionCurve(2);
        expect(curve).toHaveLength(44100);
        const mid = Math.floor(44100 / 2);
        expect(curve[mid]).toBeCloseTo(0, 5);
    });

    it('should clamp drive to at least 0.1', () => {
        const low = makeDistortionCurve(0);
        const high = makeDistortionCurve(0.1);
        expect(low[0]).toBeCloseTo(high[0], 5);
    });
});

describe('makeBitcrusherCurve', () => {
    it('should build a fixed-length curve for the given bit depth', () => {
        const curve = makeBitcrusherCurve(8);
        expect(curve).toHaveLength(65536);
        const mid = Math.floor(65536 / 2);
        expect(curve[mid]).toBeCloseTo(0, 5);
    });
});

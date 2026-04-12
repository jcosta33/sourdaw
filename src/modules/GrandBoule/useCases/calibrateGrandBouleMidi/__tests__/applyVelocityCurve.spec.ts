import { describe, it, expect } from 'vitest';

import { createDefaultMidiCalibration } from '../../../models/GrandBouleMidiCalibration';
import { applyVelocityCurve } from '../applyVelocityCurve';

describe('applyVelocityCurve', () => {
    const linear = createDefaultMidiCalibration();

    it('should map raw 0 to velocity floor', () => {
        expect(applyVelocityCurve(0, linear)).toBe(0);
    });

    it('should map raw 127 to velocity ceiling', () => {
        expect(applyVelocityCurve(127, linear)).toBe(1);
    });

    it('should map mid velocity linearly when exponent is 1', () => {
        const n = 64 / 127;
        expect(applyVelocityCurve(64, linear)).toBeCloseTo(n, 10);
    });

    it('should interpolate between floor and ceiling', () => {
        const cal = { ...linear, velocityFloor: 0.2, velocityCeiling: 0.8 };
        expect(applyVelocityCurve(0, cal)).toBe(0.2);
        expect(applyVelocityCurve(127, cal)).toBe(0.8);
    });

    it('should apply the curve exponent after normalising', () => {
        const cal = { ...linear, velocityCurveExponent: 2 };
        const n = 64 / 127;
        expect(applyVelocityCurve(64, cal)).toBeCloseTo(n * n, 10);
    });

    it('should clamp normalised input above 1 when raw velocity exceeds 127', () => {
        expect(applyVelocityCurve(300, linear)).toBe(1);
    });
});

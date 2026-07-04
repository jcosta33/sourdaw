import { describe, expect, it } from 'vitest';

import { applyVelocityCurve } from '../velocityCurveTransformer';

describe('applyVelocityCurve', () => {
    it('should map endpoints for each curve type', () => {
        expect(applyVelocityCurve(0, 'linear')).toBe(0);
        expect(applyVelocityCurve(1, 'linear')).toBe(1);

        expect(applyVelocityCurve(0, 'exponential')).toBe(0);
        expect(applyVelocityCurve(0.5, 'exponential')).toBe(0.25);

        expect(applyVelocityCurve(0, 'logarithmic')).toBe(0);
        expect(applyVelocityCurve(1, 'logarithmic')).toBe(1);

        expect(applyVelocityCurve(0, 'compress')).toBeCloseTo(0.3);
        expect(applyVelocityCurve(1, 'compress')).toBeCloseTo(0.7);
    });

    it('should use the two halves of the s-curve and expand modes', () => {
        expect(applyVelocityCurve(0.25, 's-curve')).toBeCloseTo(2 * 0.25 * 0.25);
        expect(applyVelocityCurve(0.75, 's-curve')).toBeCloseTo(1 - 2 * 0.25 * 0.25);

        expect(applyVelocityCurve(0.25, 'expand')).toBeCloseTo(0.25 * 0.3);
        expect(applyVelocityCurve(0.75, 'expand')).toBeCloseTo(0.7 + 0.25 * 1.4);
    });

    it('should reject unknown runtime curve values', () => {
        const curve = 'broken-curve' as never;

        expect(() => applyVelocityCurve(0.5, curve)).toThrow('Unknown velocity curve: broken-curve');
    });
});

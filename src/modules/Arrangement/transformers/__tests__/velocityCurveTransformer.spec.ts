import { describe, it, expect } from 'vitest';

import { applyVelocityCurve, type VelocityCurve } from '../velocityCurveTransformer';

describe('applyVelocityCurve', () => {
    it('linear returns input unchanged', () => {
        expect(applyVelocityCurve(0.5, 'linear')).toBeCloseTo(0.5);
        expect(applyVelocityCurve(0, 'linear')).toBe(0);
        expect(applyVelocityCurve(1, 'linear')).toBe(1);
    });

    it('exponential squares the value', () => {
        expect(applyVelocityCurve(0.5, 'exponential')).toBeCloseTo(0.25);
        expect(applyVelocityCurve(0.8, 'exponential')).toBeCloseTo(0.64);
    });

    it('logarithmic takes square root', () => {
        expect(applyVelocityCurve(0.25, 'logarithmic')).toBeCloseTo(0.5);
        expect(applyVelocityCurve(0.81, 'logarithmic')).toBeCloseTo(0.9);
    });

    it('s-curve produces smooth S shape', () => {
        const at_25 = applyVelocityCurve(0.25, 's-curve');
        const at_50 = applyVelocityCurve(0.5, 's-curve');
        const at_75 = applyVelocityCurve(0.75, 's-curve');
        expect(at_25).toBeLessThan(at_50);
        expect(at_50).toBeLessThan(at_75);
        expect(at_50).toBeCloseTo(0.5);
    });

    it('compress narrows to 0.3-0.7 range', () => {
        expect(applyVelocityCurve(0, 'compress')).toBeCloseTo(0.3);
        expect(applyVelocityCurve(1, 'compress')).toBeCloseTo(0.7);
        expect(applyVelocityCurve(0.5, 'compress')).toBeCloseTo(0.5);
    });

    it('expand widens dynamic range', () => {
        const at_0 = applyVelocityCurve(0, 'expand');
        const at_50 = applyVelocityCurve(0.5, 'expand');
        const at_100 = applyVelocityCurve(1, 'expand');
        expect(at_0).toBeCloseTo(0);
        expect(at_50).toBeCloseTo(0.7);
        expect(at_100).toBeCloseTo(1.4);
    });

    it('all curves produce output for 0-1 input', () => {
        const curves: VelocityCurve[] = ['linear', 'exponential', 'logarithmic', 's-curve', 'compress', 'expand'];
        for (const curve of curves) {
            for (let i = 0; i <= 100; i++) {
                const result = applyVelocityCurve(i / 100, curve);
                expect(result).toBeGreaterThanOrEqual(0);
                expect(result).toBeLessThanOrEqual(2);
            }
        }
    });
});

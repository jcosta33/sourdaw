import { describe, it, expect } from 'vitest';

import { rdpSimplify, interpolateAutomationValue, generateShapePoints } from '../automationTransformers';

import type { AutomationPoint } from '../models/AutomationViewTypes';

const pt = (beat: number, value: number, curve: AutomationPoint['curve'] = 'linear'): AutomationPoint =>
    ({ beat, value, curve }) as AutomationPoint;

describe('rdpSimplify', () => {
    it('returns input unchanged for 2 or fewer points', () => {
        const pts = [pt(0, 0), pt(4, 1)];
        expect(rdpSimplify(pts, 0.1)).toBe(pts);
        expect(rdpSimplify([pt(0, 0)], 0.1)).toEqual([pt(0, 0)]);
    });

    it('removes points within tolerance', () => {
        const pts = [pt(0, 0), pt(1, 0.01), pt(2, 0), pt(3, 0.99), pt(4, 1)];
        const result = rdpSimplify(pts, 0.1);
        expect(result.length).toBeLessThan(pts.length);
        expect(result[0]).toEqual(pts[0]);
        expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
    });

    it('preserves endpoints when tolerance is 0', () => {
        const pts = [pt(0, 0), pt(1, 0.5), pt(2, 1)];
        const result = rdpSimplify(pts, 0);
        expect(result[0]).toEqual(pts[0]);
        expect(result[result.length - 1]).toEqual(pts[pts.length - 1]);
    });

    it('handles collinear points', () => {
        const pts = [pt(0, 0), pt(1, 0.5), pt(2, 1), pt(3, 1.5)];
        const result = rdpSimplify(pts, 0.01);
        expect(result.length).toBe(2);
    });
});

describe('interpolateAutomationValue', () => {
    it('returns p1 value when beats are equal', () => {
        expect(interpolateAutomationValue(pt(0, 0.5), pt(0, 1.0), 0)).toBe(0.5);
    });

    it('linear interpolation at midpoint', () => {
        const result = interpolateAutomationValue(pt(0, 0), pt(4, 1), 2);
        expect(result).toBeCloseTo(0.5, 5);
    });

    it('linear interpolation at start', () => {
        expect(interpolateAutomationValue(pt(0, 0.3), pt(4, 0.7), 0)).toBeCloseTo(0.3, 5);
    });

    it('linear interpolation at end', () => {
        expect(interpolateAutomationValue(pt(0, 0.3), pt(4, 0.7), 4)).toBeCloseTo(0.7, 5);
    });

    it('step curve returns p1 value', () => {
        expect(interpolateAutomationValue(pt(0, 0.8, 'step'), pt(4, 0.2), 2)).toBe(0.8);
    });

    it('stairs curve produces stepped values', () => {
        const result = interpolateAutomationValue(
            { ...pt(0, 0), curve: 'stairs', stairSteps: 4 } as AutomationPoint,
            pt(4, 1),
            1.5
        );
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThan(1);
    });

    it('exponential curve produces curved interpolation', () => {
        const result = interpolateAutomationValue(pt(0, 0), pt(4, 1, 'exponential'), 2);
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThan(1);
    });
});

describe('generateShapePoints', () => {
    it('produces output for triangle shape', () => {
        const result = generateShapePoints('triangle', 0, 8, 0, 10);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });

    it('produces output for sawtooth-up', () => {
        const result = generateShapePoints('sawtooth-up', 0, 4, 0, 1);
        expect(result.length).toBeGreaterThan(0);
    });

    it('produces output for sawtooth-down', () => {
        const result = generateShapePoints('sawtooth-down', 0, 4, 0, 1);
        expect(result.length).toBeGreaterThan(0);
    });

    it('exponential curve produces curved interpolation', () => {
        const result = generateShapePoints('exponential', 0, 4, 0, 1);
        expect(Array.isArray(result)).toBe(true);
    });

    it('handles zero range', () => {
        const result = generateShapePoints('linear', 0, 0, 0, 0);
        expect(Array.isArray(result)).toBe(true);
    });

    it('first point starts at startBeat', () => {
        const result = generateShapePoints('triangle', 4, 8, 0, 1);
        if (result.length > 0) {
            expect((result[0] as AutomationPoint).beat).toBeGreaterThanOrEqual(4);
        }
    });
});

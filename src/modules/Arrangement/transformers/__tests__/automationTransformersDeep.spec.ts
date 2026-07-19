import { describe, it, expect } from 'vitest';

import { rdpSimplify, interpolateAutomationValue, generateShapePoints } from '../automationTransformers';

import type { AutomationPoint } from '../../models/AutomationViewTypes';

const pt = (beat: number, value: number, curve: AutomationPoint['curve'] = 'linear', tension = 0): AutomationPoint => ({
    beat,
    value,
    curve,
    tension,
});

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

    it('stairs curve quantizes progress into stairSteps levels', () => {
        const result = interpolateAutomationValue({ ...pt(0, 0, 'stairs'), stairSteps: 4 }, pt(4, 1), 1.5);
        // t = 1.5 / 4 = 0.375 → floor(0.375 * 4) / 4 = 0.25
        expect(result).toBeCloseTo(0.25, 5);
    });

    it('exponential curve on p1 bends the midpoint by its tension power', () => {
        const result = interpolateAutomationValue(pt(0, 0, 'exponential', 1), pt(4, 1), 2);
        // tension 1 → power 2^3 = 8 → 0.5^8
        expect(result).toBeCloseTo(0.5 ** 8, 8);
    });

    it('exponential curve with zero tension degrades to linear', () => {
        expect(interpolateAutomationValue(pt(0, 0, 'exponential'), pt(4, 1), 2)).toBeCloseTo(0.5, 5);
    });
});

describe('generateShapePoints', () => {
    it('triangle ramps min → peak at midpoint → min', () => {
        expect(generateShapePoints('triangle', 0, 8, 0, 10)).toEqual([pt(0, 0), pt(4, 10), pt(8, 0)]);
    });

    it('sawtooth-up ramps from min to max', () => {
        expect(generateShapePoints('sawtooth-up', 0, 4, 0, 1)).toEqual([pt(0, 0), pt(4, 1)]);
    });

    it('sawtooth-down ramps from max to min', () => {
        expect(generateShapePoints('sawtooth-down', 0, 4, 0, 1)).toEqual([pt(0, 1), pt(4, 0)]);
    });

    it('square uses step points high → low at midpoint → high at end', () => {
        expect(generateShapePoints('square', 0, 4, 0, 1)).toEqual([
            pt(0, 1, 'step'),
            pt(2, 0, 'step'),
            pt(4, 1, 'step'),
        ]);
    });

    it('sine produces five smooth points spanning the range', () => {
        const result = generateShapePoints('sine', 0, 8, 0, 1);
        expect(result).toHaveLength(5);
        expect(result[0]).toEqual(pt(0, 0, 'smooth', 0.5));
        expect(result[1]).toEqual(pt(2, 1, 'smooth', 0.5));
        expect(result[result.length - 1]).toEqual(pt(8, 0, 'smooth', 0.5));
    });

    it('random produces points within the value range across the beat span', () => {
        const result = generateShapePoints('random', 4, 8, 0.25, 0.75);
        expect(result).toHaveLength(9);
        for (const point of result) {
            expect(point.beat).toBeGreaterThanOrEqual(4);
            expect(point.beat).toBeLessThanOrEqual(8);
            expect(point.value).toBeGreaterThanOrEqual(0.25);
            expect(point.value).toBeLessThanOrEqual(0.75);
        }
    });

    it('collapses to zero-width points for a zero-duration range', () => {
        expect(generateShapePoints('triangle', 0, 0, 0, 0)).toEqual([pt(0, 0), pt(0, 0), pt(0, 0)]);
    });

    it('first point starts at startBeat', () => {
        const result = generateShapePoints('triangle', 4, 8, 0, 1);
        expect(result[0]?.beat).toBe(4);
    });
});

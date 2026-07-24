import { describe, expect, it } from 'vitest';

import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { generateShapePoints, getAutomationRegions, interpolateAutomationValue } from '../automationTransformers';

function pt(
    beat: number,
    value: number,
    curve: AutomationPoint['curve'] = 'linear',
    tension = 0,
    stairSteps?: number
): AutomationPoint {
    return stairSteps !== undefined ? { beat, value, curve, tension, stairSteps } : { beat, value, curve, tension };
}

describe('interpolateAutomationValue', () => {
    it('should return the first value when both points share the same beat', () => {
        const param = pt(2, 0.25);
        expect(interpolateAutomationValue(param, { ...param, value: 0.75 }, 2)).toBe(0.25);
    });

    it('should interpolate linearly by default', () => {
        expect(interpolateAutomationValue(pt(0, 0), pt(4, 1), 2)).toBeCloseTo(0.5);
    });

    it('should hold the first value for step curves until the next point', () => {
        expect(interpolateAutomationValue(pt(0, 0.2, 'step'), pt(2, 0.8, 'step'), 1)).toBe(0.2);
    });

    it('should step stairs curves using stairSteps', () => {
        const p1 = pt(0, 0, 'stairs', 0, 4);
        const p2 = pt(1, 1, 'stairs', 0, 4);
        expect(interpolateAutomationValue(p1, p2, 0.1)).toBeCloseTo(0);
        expect(interpolateAutomationValue(p1, p2, 0.25)).toBeCloseTo(0.25);
    });

    it('should default missing legacy exponential tension to linear tension', () => {
        const legacyPoint = { beat: 0, value: 0, curve: 'exponential' } satisfies Omit<AutomationPoint, 'tension'>;
        const nextPoint = pt(4, 1, 'exponential');

        expect(interpolateAutomationValue(legacyPoint as AutomationPoint, nextPoint, 2)).toBeCloseTo(0.5);
    });

    it('should default missing legacy s-curve tension to the historic midpoint tension', () => {
        const legacyPoint = { beat: 0, value: 0, curve: 's-curve' } satisfies Omit<AutomationPoint, 'tension'>;
        const nextPoint = pt(4, 1, 's-curve');

        expect(interpolateAutomationValue(legacyPoint as AutomationPoint, nextPoint, 1)).toBeCloseTo(0.203125);
    });

    it('should evaluate smooth curves with Catmull-Rom neighbors', () => {
        const p1 = pt(0, 0, 'smooth');
        const p2 = pt(1, 10, 'smooth');
        const prev = pt(-1, -5, 'linear');
        const next = pt(2, 20, 'linear');
        const value = interpolateAutomationValue(p1, p2, 0.5, prev, next);
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThan(10);
    });
});

describe('generateShapePoints', () => {
    it('should build a triangle between min and max value', () => {
        const pts = generateShapePoints('triangle', 0, 8, 0, 10);
        expect(pts).toHaveLength(3);
        expect(pts[0]!.value).toBe(0);
        expect(pts[1]!.value).toBe(10);
        expect(pts[2]!.value).toBe(0);
    });

    it('should build a two-point ramp for sawtooth-up', () => {
        const pts = generateShapePoints('sawtooth-up', 0, 1, 0, 1);
        expect(pts).toHaveLength(2);
        expect(pts[0]!.value).toBe(0);
        expect(pts[1]!.value).toBe(1);
    });

    it('should build square waves with step curves', () => {
        const pts = generateShapePoints('square', 0, 4, 0, 1);
        expect(pts.length).toBeGreaterThanOrEqual(3);
        expect(pts.some((param) => param.curve === 'step')).toBe(true);
    });

    it('should build sawtooth-down as a falling ramp', () => {
        const pts = generateShapePoints('sawtooth-down', 0, 2, 0, 1);
        expect(pts).toHaveLength(2);
        expect(pts[0]!.value).toBe(1);
        expect(pts[1]!.value).toBe(0);
    });

    it('should emit five smooth points for sine', () => {
        const pts = generateShapePoints('sine', 0, 4, 0, 1);
        expect(pts).toHaveLength(5);
        expect(pts.every((param) => param.curve === 'smooth')).toBe(true);
    });
});

describe('getAutomationRegions', () => {
    it('should return an empty list when there are no points', () => {
        expect(getAutomationRegions([])).toEqual([]);
    });

    it('should merge points within maxGap and split on larger gaps', () => {
        const points = [pt(0, 0), pt(1, 1), pt(10, 0)];
        expect(getAutomationRegions(points, 2)).toEqual([
            { startBeat: 0, endBeat: 1 },
            { startBeat: 10, endBeat: 10 },
        ]);
    });
});

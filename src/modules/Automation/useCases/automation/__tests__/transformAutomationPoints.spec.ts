import { describe, it, expect } from 'vitest';

import { transformAutomationPoints } from '../transformAutomationPoints';

import type { AutomationLane, AutomationPoint } from '#/modules/Automation/models/Automation';

/**
 * Direct unit specs for transformAutomationPoints. The function has zero direct
 * spec coverage — its per-transform wrappers have store-layer specs but the pure
 * math (clamping, anchor, empty, grid-edge) is never asserted directly.
 */

function makeLane(
    points: Array<Partial<AutomationPoint> & { beat: number; value: number }>,
    min = 0,
    max = 1
): AutomationLane {
    return {
        id: 'lane1',
        trackId: 't1',
        parameterId: 'p1',
        parameterName: 'param',
        minValue: min,
        maxValue: max,
        points: points.map((p, i) => ({
            id: `pt${i}`,
            curve: 'linear' as const,
            tension: 0,
            ...p,
        })),
        objects: [],
    } as unknown as AutomationLane;
}

function values(result: AutomationPoint[]): number[] {
    return result.map((p) => p.value);
}

function beats(result: AutomationPoint[]): number[] {
    return result.map((p) => p.beat);
}

describe('transformAutomationPoints — scale', () => {
    it('scales values around the default anchor (0)', () => {
        const lane = makeLane([{ beat: 0, value: 0.8 }]);
        const result = transformAutomationPoints(lane, { type: 'scale', factor: 2 });
        // anchor=0: 0 + (0.8 - 0) * 2 = 1.6, clamped to maxValue 1.0
        expect(values(result)).toEqual([1.0]);
    });

    it('compresses with factor < 1', () => {
        const lane = makeLane([{ beat: 0, value: 0.8 }]);
        const result = transformAutomationPoints(lane, { type: 'scale', factor: 0.5 });
        // 0 + 0.8 * 0.5 = 0.4
        expect(values(result)).toEqual([0.4]);
    });

    it('clamps to minValue for negative results', () => {
        const lane = makeLane([{ beat: 0, value: 0.3 }]);
        const result = transformAutomationPoints(lane, { type: 'scale', factor: -2 });
        // 0 + 0.3 * -2 = -0.6, clamped to 0
        expect(values(result)).toEqual([0]);
    });

    it('respects a custom anchor', () => {
        const lane = makeLane([{ beat: 0, value: 0.8 }]);
        const result = transformAutomationPoints(lane, { type: 'scale', factor: 2, anchor: 0.5 });
        // 0.5 + (0.8 - 0.5) * 2 = 0.5 + 0.6 = 1.1, clamped to 1.0
        expect(values(result)).toEqual([1.0]);
    });

    it('inverts around the anchor with factor -1', () => {
        const lane = makeLane([{ beat: 0, value: 0.25 }]);
        const result = transformAutomationPoints(lane, { type: 'scale', factor: -1, anchor: 0.5 });
        // 0.5 + (0.25 - 0.5) * -1 = 0.5 + 0.25 = 0.75
        expect(values(result)).toEqual([0.75]);
    });

    it('does not clamp when result is within range', () => {
        const lane = makeLane([
            { beat: 0, value: 0.4 },
            { beat: 1, value: 0.6 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'scale', factor: 0.5, anchor: 0.5 });
        // 0.5 + (0.4-0.5)*0.5 = 0.45; 0.5 + (0.6-0.5)*0.5 = 0.55
        expect(values(result)).toEqual([0.45, 0.55]);
    });
});

describe('transformAutomationPoints — invert', () => {
    it('inverts values via maxValue - (value - minValue)', () => {
        const lane = makeLane([
            { beat: 0, value: 0.25 },
            { beat: 1, value: 0.75 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'invert' });
        // 1 - (0.25 - 0) = 0.75; 1 - (0.75 - 0) = 0.25
        expect(values(result)).toEqual([0.75, 0.25]);
    });

    it('inversion is its own inverse (double-invert returns original)', () => {
        const lane = makeLane([
            { beat: 0, value: 0.3 },
            { beat: 1, value: 0.7 },
        ]);
        const once = transformAutomationPoints(lane, { type: 'invert' });
        const twice = transformAutomationPoints({ ...lane, points: once }, { type: 'invert' });
        expect(twice[0]?.value).toBeCloseTo(0.3, 10);
        expect(twice[1]?.value).toBeCloseTo(0.7, 10);
    });

    it('inverts with a custom range', () => {
        const lane = makeLane([{ beat: 0, value: 10 }], 0, 100);
        const result = transformAutomationPoints(lane, { type: 'invert' });
        // 100 - (10 - 0) = 90
        expect(values(result)).toEqual([90]);
    });

    it('mirrors bezier control-point y-values about the lane midpoint, not just the point value', () => {
        // A no-op round trip would pass trivially even if cp1/cp2 were never
        // touched at all, so this asserts the mirrored shape after a SINGLE
        // invert: maxValue - (y - minValue) = 1 - y for the default [0,1] lane.
        // cp.x is a segment-relative time fraction and must stay untouched.
        const lane = makeLane([
            { beat: 0, value: 0.25, curve: 'bezier', cp1: { x: 0.2, y: 0.25 }, cp2: { x: 0.8, y: 0.75 } },
        ]);
        const result = transformAutomationPoints(lane, { type: 'invert' });
        expect(result[0]?.cp1).toEqual({ x: 0.2, y: 0.75 });
        expect(result[0]?.cp2).toEqual({ x: 0.8, y: 0.25 });
    });

    it('double-invert returns the exact original points, including curve fields', () => {
        // cp1/cp2 y-values live in the same absolute units as `value` (see
        // evaluateAutomationCurve, which feeds `cp1.y ?? firstPoint.value`
        // straight into the same cubicBezier() call as the endpoint values) —
        // so an invert that mirrors `value` but not `cp1`/`cp2` bows the bezier
        // shape onto the wrong side of the mirror. cp.x is a segment-relative
        // time fraction, never touched by a value-space mirror.
        const lane = makeLane([
            {
                beat: 0,
                value: 0.25,
                curve: 'bezier',
                tension: 0.4,
                cp1: { x: 0.2, y: 0.25 },
                cp2: { x: 0.8, y: 0.75 },
            },
            { beat: 1, value: 0.75, curve: 'exponential', tension: -0.5 },
        ]);
        const once = transformAutomationPoints(lane, { type: 'invert' });
        const twice = transformAutomationPoints({ ...lane, points: once }, { type: 'invert' });
        expect(twice).toEqual(lane.points);
    });
});

describe('transformAutomationPoints — stretch', () => {
    it('stretches beats around the default anchor (min beat)', () => {
        const lane = makeLane([
            { beat: 0, value: 0.5 },
            { beat: 1, value: 0.5 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'stretch', factor: 2 });
        // anchor = 0 (min beat). beat: 0 + (0-0)*2=0, 0 + (1-0)*2=2
        expect(beats(result)).toEqual([0, 2]);
    });

    it('clamps negative stretched beats to 0', () => {
        const lane = makeLane([
            { beat: 1, value: 0.5 },
            { beat: 2, value: 0.5 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'stretch', factor: -1, anchorBeat: 0 });
        // 0 + (1-0)*(-1) = -1 → max(0, -1) = 0; 0 + (2-0)*(-1) = -2 → 0
        expect(beats(result)).toEqual([0, 0]);
    });

    it('compresses beats with factor < 1', () => {
        const lane = makeLane([
            { beat: 0, value: 0.5 },
            { beat: 4, value: 0.5 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'stretch', factor: 0.5 });
        // anchor=0: 0 + 0*0.5=0, 0 + 4*0.5=2
        expect(beats(result)).toEqual([0, 2]);
    });

    it('uses a custom anchorBeat', () => {
        const lane = makeLane([
            { beat: 0, value: 0.5 },
            { beat: 2, value: 0.5 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'stretch', factor: 2, anchorBeat: 2 });
        // 2 + (0-2)*2 = -2 → 0; 2 + (2-2)*2 = 2
        expect(beats(result)).toEqual([0, 2]);
    });

    it('sorts stretched points by beat', () => {
        const lane = makeLane([
            { beat: 0, value: 0.5 },
            { beat: 1, value: 0.5 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'stretch', factor: -1, anchorBeat: 1 });
        // 1 + (0-1)*(-1) = 2; 1 + (1-1)*(-1) = 1 → sorted [1, 2]
        expect(beats(result)).toEqual([1, 2]);
    });
});

describe('transformAutomationPoints — reverse', () => {
    it('reverses beat positions: beat = minBeat + maxBeat - point.beat', () => {
        const lane = makeLane([
            { beat: 0, value: 0.1 },
            { beat: 2, value: 0.2 },
            { beat: 4, value: 0.3 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'reverse' });
        // minBeat=0, maxBeat=4. New beats: 4, 2, 0 → sorted [0, 2, 4]
        expect(beats(result)).toEqual([0, 2, 4]);
        // Values should follow their reversed beats: point at beat 4 → value 0.3,
        // reversed to beat 0. Point at beat 0 → value 0.1, reversed to beat 4.
        expect(result[0]?.value).toBe(0.3);
        expect(result[2]?.value).toBe(0.1);
    });

    it('returns empty array for empty lane', () => {
        const lane = makeLane([]);
        const result = transformAutomationPoints(lane, { type: 'reverse' });
        expect(result).toEqual([]);
    });

    it('re-associates curve data with the segment it belongs to, not the point that carried it', () => {
        // evaluateAutomationCurve reads curve/tension/cp1/cp2/stairSteps off
        // `firstPoint` (the earlier-beat point of a pair) to shape the segment
        // toward its next neighbour. The original [0,2] segment is 'bezier',
        // anchored on the point at beat 0. After reversing, that physical span
        // sits between new beats 2 and 4 (mirror(0)=4, mirror(2)=2) — its
        // shape must move to the new segment's earlier point, beat 2.
        const lane = makeLane([
            { beat: 0, value: 0, curve: 'bezier', tension: 0, cp1: { x: 0.1, y: 0.1 }, cp2: { x: 0.9, y: 0.9 } },
            { beat: 2, value: 0.5, curve: 'linear' },
            { beat: 4, value: 1, curve: 'step' },
        ]);
        const result = transformAutomationPoints(lane, { type: 'reverse' });
        const atBeat2 = result.find((p) => p.beat === 2);
        expect(atBeat2?.curve).toBe('bezier');
        expect(atBeat2?.cp1).toEqual({ x: 0.1, y: 0.1 });
        expect(atBeat2?.cp2).toEqual({ x: 0.9, y: 0.9 });
    });

    it('double-reverse returns the exact original points, including curve fields', () => {
        const lane = makeLane([
            {
                beat: 0,
                value: 0.1,
                curve: 'bezier',
                tension: 0.2,
                cp1: { x: 0.25, y: 0.4 },
                cp2: { x: 0.75, y: 0.6 },
            },
            { beat: 2, value: 0.5, curve: 'exponential', tension: 0.7 },
            { beat: 4, value: 0.9, curve: 's-curve', tension: -0.3 },
        ]);
        const once = transformAutomationPoints(lane, { type: 'reverse' });
        const twice = transformAutomationPoints({ ...lane, points: once }, { type: 'reverse' });
        expect(twice).toEqual(lane.points);
    });
});

describe('transformAutomationPoints — thin', () => {
    it('returns cloned points unchanged when lane has <= 2 points', () => {
        const lane = makeLane([
            { beat: 0, value: 0.5 },
            { beat: 1, value: 0.5 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'thin' });
        expect(result.length).toBe(2);
        expect(beats(result)).toEqual([0, 1]);
    });

    it('returns cloned single point unchanged', () => {
        const lane = makeLane([{ beat: 5, value: 0.9 }]);
        const result = transformAutomationPoints(lane, { type: 'thin' });
        expect(result.length).toBe(1);
        expect(beats(result)).toEqual([5]);
    });

    it('thins collinear points when > 2 points', () => {
        // Three collinear points should be thinned to 2 (start + end).
        const lane = makeLane([
            { beat: 0, value: 0 },
            { beat: 1, value: 0.5 },
            { beat: 2, value: 1 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'thin', tolerance: 0.01 });
        // Collinear middle point removed → 2 points.
        expect(result.length).toBe(2);
    });
});

describe('transformAutomationPoints — quantize', () => {
    it('snaps beats to the nearest grid multiple', () => {
        const lane = makeLane([
            { beat: 0.3, value: 0.5 },
            { beat: 1.7, value: 0.5 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'quantize', gridSize: 0.5 });
        // round(0.3/0.5)*0.5 = round(0.6)*0.5 = 1*0.5 = 0.5
        // round(1.7/0.5)*0.5 = round(3.4)*0.5 = 3*0.5 = 1.5
        expect(beats(result)).toEqual([0.5, 1.5]);
    });

    it('deduplicates points that snap to the same beat (last wins)', () => {
        const lane = makeLane([
            { beat: 0.4, value: 0.1 },
            { beat: 0.6, value: 0.9 },
        ]);
        // gridSize 0.5: round(0.4/0.5)*0.5 = round(0.8)*0.5 = 0.5
        // round(0.6/0.5)*0.5 = round(1.2)*0.5 = 0.5. Both → 0.5. Last wins (0.9).
        const result = transformAutomationPoints(lane, { type: 'quantize', gridSize: 0.5 });
        expect(result.length).toBe(1);
        expect(result[0]?.beat).toBe(0.5);
        expect(result[0]?.value).toBe(0.9);
    });

    it('returns cloned points unchanged when gridSize <= 0', () => {
        const lane = makeLane([{ beat: 0.3, value: 0.5 }]);
        const result = transformAutomationPoints(lane, { type: 'quantize', gridSize: 0 });
        expect(beats(result)).toEqual([0.3]);
    });

    it('returns cloned points unchanged when gridSize is NaN', () => {
        const lane = makeLane([{ beat: 0.3, value: 0.5 }]);
        const result = transformAutomationPoints(lane, { type: 'quantize', gridSize: Number.NaN });
        expect(beats(result)).toEqual([0.3]);
    });

    it('returns cloned points unchanged when gridSize is Infinity', () => {
        const lane = makeLane([{ beat: 0.3, value: 0.5 }]);
        const result = transformAutomationPoints(lane, { type: 'quantize', gridSize: Number.POSITIVE_INFINITY });
        expect(beats(result)).toEqual([0.3]);
    });

    it('sorts quantized points by beat', () => {
        const lane = makeLane([
            { beat: 1.7, value: 0.5 },
            { beat: 0.3, value: 0.5 },
        ]);
        const result = transformAutomationPoints(lane, { type: 'quantize', gridSize: 0.5 });
        // 0.3→0.5, 1.7→1.5 → sorted [0.5, 1.5]
        expect(beats(result)).toEqual([0.5, 1.5]);
    });
});

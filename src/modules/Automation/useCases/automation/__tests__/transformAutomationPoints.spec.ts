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
        // shape must move to the new segment's earlier point, beat 2. The
        // bezier controls also swap and mirror their x (time swaps, value
        // does not) — see the 'mirrors and swaps bezier control points' spec
        // below for that transform in isolation.
        // x's are dyadic fractions (0.25/0.75) so `1 - x` round-trips exactly
        // in floating point — the assertion is about the swap/mirror, not
        // about float precision.
        const lane = makeLane([
            { beat: 0, value: 0, curve: 'bezier', tension: 0, cp1: { x: 0.25, y: 0.1 }, cp2: { x: 0.75, y: 0.9 } },
            { beat: 2, value: 0.5, curve: 'linear' },
            { beat: 4, value: 1, curve: 'step' },
        ]);
        const result = transformAutomationPoints(lane, { type: 'reverse' });
        const atBeat2 = result.find((p) => p.beat === 2);
        expect(atBeat2?.curve).toBe('bezier');
        expect(atBeat2?.cp1).toEqual({ x: 0.25, y: 0.9 });
        expect(atBeat2?.cp2).toEqual({ x: 0.75, y: 0.1 });
    });

    it('mirrors and swaps bezier control points when the curve data moves to its new segment anchor', () => {
        // A cubic from (0,v0) to (1,v1) with controls C1,C2, traversed
        // backwards, is the cubic from (0,v1) to (1,v0) with controls
        // (1-C2.x, C2.y) and (1-C1.x, C1.y): time flips (x mirrors, the two
        // controls swap slots), value does not (y stays put). x's (0.25/0.75,
        // dyadic so `1 - x` is exact in floating point) and y's (0.2/0.8) are
        // deliberately different so a bug that only swaps, only mirrors, or
        // does neither is caught — a round trip alone would not catch this,
        // since a double swap-and-mirror is an identity just like a double
        // no-op is.
        const lane = makeLane([
            { beat: 0, value: 0, curve: 'bezier', cp1: { x: 0.25, y: 0.2 }, cp2: { x: 0.75, y: 0.8 } },
            { beat: 2, value: 1, curve: 'linear' },
        ]);
        const once = transformAutomationPoints(lane, { type: 'reverse' });
        // mirror(0)=2, mirror(2)=0 — the bezier's original left point (beat 0)
        // is now the terminal point; the new anchor (new beat 0) is the old
        // point at beat 2, which inherits the transformed bezier data.
        const anchor = once.find((p) => p.beat === 0);
        expect(anchor?.curve).toBe('bezier');
        expect(anchor?.cp1).toEqual({ x: 0.25, y: 0.8 });
        expect(anchor?.cp2).toEqual({ x: 0.75, y: 0.2 });

        const twice = transformAutomationPoints({ ...lane, points: once }, { type: 'reverse' });
        const restoredAnchor = twice.find((p) => p.beat === 0);
        expect(restoredAnchor?.cp1).toEqual({ x: 0.25, y: 0.2 });
        expect(restoredAnchor?.cp2).toEqual({ x: 0.75, y: 0.8 });
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

        // A lane with a duplicate beat is how this codebase writes a hard
        // jump (see addAutomationPoint: a tie lands after the existing
        // equal-beat point; handleRemoveAutomationPoint branches on
        // `beatDuplicated` for undo safety) — and it is the one case a
        // distinct-beat lane can never exercise. `Array.prototype.sort` is
        // stable, so relocating points by a beat-keyed sort alone leaves two
        // tied points in their original relative order instead of swapping
        // it; a true time-reversal of a jump must swap which point is the
        // anchor, along with its curve data. A no-op curve permutation would
        // pass this round trip trivially (curve never moves, so it can't
        // land wrong) — this lane is only meaningful together with the
        // segment-reassignment specs above, which prove curve data does move.
        const jumpLane = makeLane([
            { beat: 0, value: 0, curve: 'linear' },
            { beat: 2, value: 10, curve: 'step' },
            { beat: 2, value: 20, curve: 'exponential', tension: 0.5 },
            { beat: 4, value: 30, curve: 's-curve' },
        ]);
        const jumpOnce = transformAutomationPoints(jumpLane, { type: 'reverse' });
        const jumpTwice = transformAutomationPoints({ ...jumpLane, points: jumpOnce }, { type: 'reverse' });
        expect(jumpTwice).toEqual(jumpLane.points);
    });

    it('reversing a lane with a duplicate beat swaps the tied points, not only their curve data', () => {
        // The jump reads, forward, as "hold 10 up to beat 2, then jump to 20
        // and hold to beat 4". A correct time-reversal must read as the jump
        // played backwards: "hold 30 down to beat 4→2 [now 2→0 mirrored],
        // land on 20, then jump down to 10 and hold to beat 0" — i.e. the
        // *order* of the two beat-2 points must swap (20 before 10), not
        // stay (10 before 20) as a beat-only stable sort would leave it.
        const jumpLane = makeLane([
            { beat: 0, value: 0, curve: 'linear' },
            { beat: 2, value: 10, curve: 'step' },
            { beat: 2, value: 20, curve: 'exponential', tension: 0.5 },
            { beat: 4, value: 30, curve: 's-curve' },
        ]);
        const result = transformAutomationPoints(jumpLane, { type: 'reverse' });
        expect(beats(result)).toEqual([0, 2, 2, 4]);
        expect(values(result)).toEqual([30, 20, 10, 0]);
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

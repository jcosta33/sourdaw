import { type AutomationPoint } from '../models/Automation';

import { sampleStoredLaneCurve } from './sampleStoredLaneCurve';

/**
 * The range-write law: a lane holds one target value across `[startBeat, endBeat)`, ramps linearly
 * into it from the value it already drew at the start and back out to the value it already drew at
 * the end, and draws exactly what it drew before at every beat outside the range.
 *
 * Outside preservation is a property of the segments a boundary cuts, not of sampling. A linear
 * segment cut at a boundary keeps its line when it ends on the value the line reaches there, and a
 * step segment holds its value whatever point ends it, so both split exactly. Every other curve is
 * shaped by its whole span — an exponential's warp, an s-curve's knee, a staircase's step count, a
 * Bézier's control points — so cutting one would redraw the part left outside, and the cut is
 * refused rather than approximated. A boundary landing exactly on a point needs no cut. A
 * Catmull-Rom (`smooth`) segment reads its neighbours' values, so one beside a boundary stands only
 * while the neighbour it reads keeps its value.
 */

type BuildParameterRangePointsInput = {
    /** The lane's points, sorted by beat. Empty for a lane that holds no curve yet. */
    points: readonly AutomationPoint[];
    /** The value the parameter plays at while its lane holds no points. */
    baseValue: number;
    startBeat: number;
    endBeat: number;
    /** The value the range holds, in the lane's own units. */
    targetValue: number;
    /** Beats the ramp from the start value into the target takes. */
    rampIn: number;
    /** Beats the ramp from the target back to the end value takes. */
    rampOut: number;
    /** Identity for the n-th point this write adds. */
    pointId: (index: number) => string;
};

export type ParameterRangePointsRefusal = 'nonlinear-boundary' | 'ramps-exceed-range';

export type ParameterRangePoints =
    { ok: true; points: AutomationPoint[] } | { ok: false; refusal: ParameterRangePointsRefusal; reason: string };

type PointShape = Omit<AutomationPoint, 'id' | 'tension'> & { tension?: number };

type Boundary = { ok: true; point: PointShape } | { ok: false; reason: string };

function interpolateLinear(first: AutomationPoint, second: AutomationPoint, beat: number): number {
    if (second.beat === beat) {
        return second.value;
    }
    return first.value + ((second.value - first.value) * (beat - first.beat)) / (second.beat - first.beat);
}

function cutsNonlinearSegment(boundary: 'start' | 'end', beat: number, curve: string): Boundary {
    return {
        ok: false,
        reason: `The range ${boundary} at beat ${String(beat)} falls inside a ${curve} segment, and cutting it would redraw the curve outside the range.`,
    };
}

/**
 * The point the range opens on, chosen so the segment ending there draws what the old segment drew
 * before the start: the old line's own value at the start after a linear point, any value after a
 * step, and the old point's value when one already sits on the start.
 */
function openingPoint(
    points: readonly AutomationPoint[],
    beforeCount: number,
    startBeat: number,
    startValue: number,
    baseValue: number
): Boundary {
    const lastBefore = points[beforeCount - 1];
    const next = points[beforeCount];
    if (lastBefore === undefined) {
        return { ok: true, point: { beat: startBeat, value: next?.value ?? baseValue, curve: 'linear' } };
    }
    if (lastBefore.curve === 'step') {
        return { ok: true, point: { beat: startBeat, value: startValue, curve: 'linear' } };
    }
    if (lastBefore.curve === 'linear') {
        const value = next === undefined ? lastBefore.value : interpolateLinear(lastBefore, next, startBeat);
        return { ok: true, point: { beat: startBeat, value, curve: 'linear' } };
    }
    if (next?.beat === startBeat && lastBefore.curve !== 'smooth') {
        return { ok: true, point: { beat: startBeat, value: next.value, curve: 'linear' } };
    }
    return cutsNonlinearSegment('start', startBeat, lastBefore.curve);
}

/**
 * The point the range closes on, carrying the curve of the segment that leaves it so that segment
 * draws what the old one drew after the end.
 */
function closingPoint(
    points: readonly AutomationPoint[],
    afterIndex: number,
    endBeat: number,
    endValue: number
): Boundary {
    const firstAfter = points[afterIndex];
    const lastAtEnd = points[afterIndex - 1];
    if (firstAfter === undefined) {
        return { ok: true, point: { beat: endBeat, value: endValue, curve: 'linear' } };
    }
    if (lastAtEnd === undefined) {
        return { ok: true, point: { beat: endBeat, value: firstAfter.value, curve: 'linear' } };
    }
    if (lastAtEnd.curve === 'step') {
        return { ok: true, point: { beat: endBeat, value: lastAtEnd.value, curve: 'step' } };
    }
    if (lastAtEnd.curve === 'linear') {
        return {
            ok: true,
            point: { beat: endBeat, value: interpolateLinear(lastAtEnd, firstAfter, endBeat), curve: 'linear' },
        };
    }
    if (lastAtEnd.beat === endBeat && lastAtEnd.curve !== 'smooth') {
        const { id: _id, ...shape } = lastAtEnd;
        return { ok: true, point: shape };
    }
    return cutsNonlinearSegment('end', endBeat, lastAtEnd.curve);
}

/**
 * Whether a `smooth` segment outside the range reads a neighbour whose value the write changes.
 * The segment just before the start reads the point after its own end; the one just after the end
 * reads the point before its own start.
 */
function moveSmoothNeighbour(
    points: readonly AutomationPoint[],
    beforeCount: number,
    afterIndex: number,
    opening: PointShape,
    closing: PointShape
): string | null {
    const beforeSmooth = points[beforeCount - 2];
    const lastBefore = points[beforeCount - 1];
    if (beforeSmooth?.curve === 'smooth' && lastBefore !== undefined) {
        const readValue = points[beforeCount]?.value ?? lastBefore.value;
        if (readValue !== opening.value) {
            return `The smooth curve ending at beat ${String(lastBefore.beat)} bends toward the value the range start replaces, so the write would redraw it outside the range.`;
        }
    }
    const afterSmooth = points[afterIndex];
    if (afterSmooth?.curve === 'smooth' && points[afterIndex + 1] !== undefined) {
        const readValue = points[afterIndex - 1]?.value ?? afterSmooth.value;
        if (readValue !== closing.value) {
            return `The smooth curve starting at beat ${String(afterSmooth.beat)} bends from the value the range end replaces, so the write would redraw it outside the range.`;
        }
    }
    return null;
}

/** Appends a point, folding it into the previous one when both sit at the same beat and value. */
function appendPoint(written: PointShape[], point: PointShape): void {
    const previous = written.at(-1);
    if (previous !== undefined && previous.beat === point.beat && previous.value === point.value) {
        written[written.length - 1] = point;
        return;
    }
    written.push(point);
}

type RangeShapeInput = {
    opening: PointShape;
    closing: PointShape;
    startBeat: number;
    endBeat: number;
    startValue: number;
    targetValue: number;
    rampIn: number;
    rampOut: number;
};

function shapeRange({
    opening,
    closing,
    startBeat,
    endBeat,
    startValue,
    targetValue,
    rampIn,
    rampOut,
}: RangeShapeInput): PointShape[] {
    // The hold's beats are clamped into order: ramps that fill the range meet at a beat the two
    // sums can round to opposite sides of, and the lane would re-sort the points it stores, so the
    // inverse would no longer match what the write left.
    const holdStart = Math.min(startBeat + rampIn, endBeat);
    const holdEnd = Math.max(endBeat - rampOut, holdStart);
    const written: PointShape[] = [];
    appendPoint(written, opening);
    if (rampIn > 0) {
        appendPoint(written, { beat: startBeat, value: startValue, curve: 'linear' });
    }
    appendPoint(written, { beat: holdStart, value: targetValue, curve: 'linear' });
    appendPoint(written, { beat: holdEnd, value: targetValue, curve: 'linear' });
    appendPoint(written, closing);
    return written;
}

export function buildParameterRangePoints({
    points,
    baseValue,
    startBeat,
    endBeat,
    targetValue,
    rampIn,
    rampOut,
    pointId,
}: BuildParameterRangePointsInput): ParameterRangePoints {
    if (rampIn + rampOut > endBeat - startBeat) {
        return {
            ok: false,
            refusal: 'ramps-exceed-range',
            reason: `Ramps of ${String(rampIn)} and ${String(rampOut)} beats do not fit in a range of ${String(endBeat - startBeat)} beats.`,
        };
    }
    const beforeCount = points.filter((point) => point.beat < startBeat).length;
    const firstAfter = points.findIndex((point) => point.beat > endBeat);
    const afterIndex = firstAfter < 0 ? points.length : firstAfter;
    const startValue = sampleStoredLaneCurve(points, baseValue, startBeat);
    const opening = openingPoint(points, beforeCount, startBeat, startValue, baseValue);
    if (!opening.ok) {
        return { ok: false, refusal: 'nonlinear-boundary', reason: opening.reason };
    }
    const closing = closingPoint(points, afterIndex, endBeat, sampleStoredLaneCurve(points, baseValue, endBeat));
    if (!closing.ok) {
        return { ok: false, refusal: 'nonlinear-boundary', reason: closing.reason };
    }
    const smoothNeighbour = moveSmoothNeighbour(points, beforeCount, afterIndex, opening.point, closing.point);
    if (smoothNeighbour !== null) {
        return { ok: false, refusal: 'nonlinear-boundary', reason: smoothNeighbour };
    }
    const written = shapeRange({
        opening: opening.point,
        closing: closing.point,
        startBeat,
        endBeat,
        startValue,
        targetValue,
        rampIn,
        rampOut,
    }).map((point, index): AutomationPoint => ({ tension: 0, ...point, id: pointId(index) }));
    return { ok: true, points: [...points.slice(0, beforeCount), ...written, ...points.slice(afterIndex)] };
}

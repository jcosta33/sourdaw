import { evaluateAutomationCurve, type AutomationCurvePoint, type AutomationCurveType } from './automationCurve';

type CurvePoint = AutomationCurvePoint & { tension: number };

// Only a straight ramp or a hold keeps its curve law when re-based on either side of an interior beat.
const SPLIT_EXACT_CURVES: ReadonlySet<AutomationCurveType> = new Set(['linear', 'step']);

// Bézier controls and smooth neighbours can move a segment with equal endpoint values.
const FLAT_EXACT_CURVES: ReadonlySet<AutomationCurveType> = new Set([
    'linear',
    'step',
    'stairs',
    'exponential',
    's-curve',
]);

function continueShapeOf(left: CurvePoint, beat: number, value: number): CurvePoint {
    const point: CurvePoint = { beat, value, curve: left.curve, tension: left.tension };
    if (left.stairSteps !== undefined) {
        point.stairSteps = left.stairSteps;
    }
    return point;
}

/** Adding a neighbour changes the tangents of nearby smooth segments. */
function changesSmoothSegment(
    previous: CurvePoint | undefined,
    left: CurvePoint,
    right: CurvePoint | undefined
): boolean {
    return left.curve === 'smooth' || previous?.curve === 'smooth' || right?.curve === 'smooth';
}

/** Resolve a point that leaves the original curve unchanged on both sides of the split. */
export function resolveAutomationCurveSplit(points: readonly CurvePoint[], beat: number): CurvePoint | undefined {
    if (!Number.isFinite(beat) || beat < 0 || points.some((point) => point.beat === beat)) {
        return undefined;
    }
    const rightIndex = points.findIndex((point) => point.beat > beat);
    const leftIndex = rightIndex === -1 ? points.length - 1 : rightIndex - 1;
    const left = points[leftIndex];
    const right = rightIndex === -1 ? undefined : points[rightIndex];
    if (left === undefined) {
        if (right === undefined) {
            return undefined;
        }
        // The lane holds the first point's value before it.
        return { beat, value: right.value, curve: 'linear', tension: 0 };
    }
    if (changesSmoothSegment(points[leftIndex - 1], left, right)) {
        return undefined;
    }
    if (right === undefined) {
        return FLAT_EXACT_CURVES.has(left.curve) ? continueShapeOf(left, beat, left.value) : undefined;
    }
    if (!SPLIT_EXACT_CURVES.has(left.curve)) {
        return undefined;
    }
    return continueShapeOf(left, beat, evaluateAutomationCurve({ firstPoint: left, secondPoint: right, beat }));
}

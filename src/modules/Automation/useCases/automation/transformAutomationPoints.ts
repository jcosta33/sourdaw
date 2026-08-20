import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { simplifyAutomationPoints } from '../../services/automationPointAlgorithms';

type AutomationPointTransform =
    | { type: 'scale'; factor: number; anchor?: number }
    | { type: 'stretch'; factor: number; anchorBeat?: number }
    | { type: 'invert' }
    | { type: 'reverse' }
    | { type: 'thin'; tolerance?: number }
    | { type: 'quantize'; gridSize: number };

function clonePoint(point: AutomationPoint): AutomationPoint {
    const clone = { ...point };
    if (point.cp1) {
        clone.cp1 = { ...point.cp1 };
    }
    if (point.cp2) {
        clone.cp2 = { ...point.cp2 };
    }
    return clone;
}

function stretchPoints(lane: AutomationLane, factor: number, anchorBeat?: number): AutomationPoint[] {
    let anchor = anchorBeat;
    if (anchor === undefined) {
        let minBeat = Infinity;
        for (const point of lane.points) {
            if (point.beat < minBeat) {
                minBeat = point.beat;
            }
        }
        anchor = minBeat === Infinity ? 0 : minBeat;
    }
    return lane.points
        .map((point) => ({
            ...clonePoint(point),
            beat: Math.max(0, anchor + (point.beat - anchor) * factor),
        }))
        .sort((alpha, beta) => alpha.beat - beta.beat);
}

/**
 * `evaluateAutomationCurve` (src/utils/automationCurve.ts) reads
 * `curve`/`tension`/`stairSteps`/`cp1`/`cp2` off `firstPoint` — the
 * earlier-beat point of a pair — to shape the segment toward its *next*
 * neighbour. A segment's shape therefore belongs to the span, anchored on its
 * left point, not to either point independently.
 *
 * Reversing flips which physical points fall on the left of each span: the
 * segment that was [points[j], points[j+1]] keeps the same two points and the
 * same curve data, but after the beat-mirror that pair is traversed the other
 * way, so its *new* left anchor is the mirrored points[j+1]. Concretely, for
 * a lane of `n` points sorted by beat, the point ending up at new position
 * `k` needs the curve fields that lived at old position `k - 1` (its original
 * predecessor) — this is a fixed permutation over the `n - 1` real segments,
 * proven self-inverse (a second reverse restores every field exactly).
 *
 * The very last point never owns an outgoing segment, so its curve fields are
 * inert data with nowhere principled to go; they simply ride along to
 * whichever point becomes the new terminal point (the old first point), which
 * is why the very first point in `curveSources` order takes the *last*
 * point's fields unchanged rather than folding into the same formula.
 */
function reversePoints(lane: AutomationLane): AutomationPoint[] {
    const points = lane.points;
    const count = points.length;
    if (count === 0) {
        return [];
    }
    let minBeat = Infinity;
    let maxBeat = -Infinity;
    for (const point of points) {
        if (point.beat < minBeat) {
            minBeat = point.beat;
        }
        if (point.beat > maxBeat) {
            maxBeat = point.beat;
        }
    }

    // curveSources[k] holds the curve data for the point that will end up at
    // new sorted position k: the first (count - 1) real segments reverse
    // their anchor order; the inert terminal slot rides along unchanged.
    const curveSources =
        count === 1
            ? points
            : points
                  .slice(0, count - 1)
                  .reverse()
                  .concat(points[count - 1]!);

    return points
        .map((point, index) => {
            const curveSource = curveSources[count - 1 - index]!;
            return {
                ...clonePoint(point),
                beat: minBeat + maxBeat - point.beat,
                curve: curveSource.curve,
                tension: curveSource.tension,
                stairSteps: curveSource.stairSteps,
                cp1: curveSource.cp1 ? { ...curveSource.cp1 } : undefined,
                cp2: curveSource.cp2 ? { ...curveSource.cp2 } : undefined,
            };
        })
        .sort((alpha, beta) => alpha.beat - beta.beat);
}

export function transformAutomationPoints(
    lane: AutomationLane,
    transform: AutomationPointTransform
): AutomationPoint[] {
    if (transform.type === 'scale') {
        const anchor = transform.anchor ?? 0;
        return lane.points.map((point) => ({
            ...clonePoint(point),
            value: Math.min(lane.maxValue, Math.max(lane.minValue, anchor + (point.value - anchor) * transform.factor)),
        }));
    }
    if (transform.type === 'stretch') {
        return stretchPoints(lane, transform.factor, transform.anchorBeat);
    }
    if (transform.type === 'invert') {
        // cp1.y/cp2.y live in the same absolute value units as `point.value`
        // (evaluateAutomationCurve feeds `cp1.y ?? firstPoint.value` straight
        // into the same cubicBezier() call as the endpoint values) — mirroring
        // `value` without also mirroring them bows a bezier segment onto the
        // wrong side of the inverted curve. cp1.x/cp2.x are a segment-relative
        // time fraction (0..1), never a value, so inverting leaves them alone.
        // `tension` needs no sign flip: every non-linear curve shape (stairs,
        // exponential, s-curve, smooth) is an affine combination of the
        // segment's endpoint/neighbour values with weights that sum to 1 and
        // depend only on the beat fraction — mirroring every value the
        // combination reads therefore mirrors its result automatically,
        // regardless of tension's sign.
        const mirror = (value: number) => lane.maxValue - (value - lane.minValue);
        return lane.points.map((point) => ({
            ...clonePoint(point),
            value: mirror(point.value),
            cp1: point.cp1 ? { x: point.cp1.x, y: mirror(point.cp1.y) } : undefined,
            cp2: point.cp2 ? { x: point.cp2.x, y: mirror(point.cp2.y) } : undefined,
        }));
    }
    if (transform.type === 'reverse') {
        return reversePoints(lane);
    }
    if (transform.type === 'thin') {
        if (lane.points.length <= 2) {
            return lane.points.map(clonePoint);
        }
        return simplifyAutomationPoints({ points: lane.points, tolerance: transform.tolerance ?? 0.01 }).map(
            clonePoint
        );
    }
    if (!(transform.gridSize > 0) || !Number.isFinite(transform.gridSize)) {
        return lane.points.map(clonePoint);
    }
    const snapped = new Map<number, AutomationPoint>();
    for (const point of lane.points) {
        const beat = Math.round(point.beat / transform.gridSize) * transform.gridSize;
        snapped.set(beat, { ...clonePoint(point), beat });
    }
    return Array.from(snapped.values()).sort((alpha, beta) => alpha.beat - beta.beat);
}

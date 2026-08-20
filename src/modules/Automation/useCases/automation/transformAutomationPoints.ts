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
 * Mirror a single bezier control point across the segment's time axis. `x`
 * (see `evaluateAutomationCurve`'s `cx1`/`cx2`) is a fraction of the span, 0
 * at the segment's start and 1 at its end; traversing the span backwards
 * flips it to `1 - x`. `y` (`cy1`/`cy2`) is an absolute value, not a time
 * position, so reversing — which mirrors *time*, not value — leaves it
 * untouched. `undefined` (the "use the endpoint value" default) passes
 * through unchanged.
 */
function mirrorBezierTimeAxis(point: { x: number; y: number } | undefined): { x: number; y: number } | undefined {
    if (!point) {
        return undefined;
    }
    return { x: 1 - point.x, y: point.y };
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
 * `points` can hold two entries at the same beat — that is how this codebase
 * writes a hard automation jump (`addAutomationPoint` lands a tie after the
 * existing equal-beat point; `handleRemoveAutomationPoint` branches on
 * `beatDuplicated` for undo safety). A jump's two tied points are not
 * interchangeable: the array-earlier one is the value held *approaching* the
 * jump, the array-later one is the value that takes over *at and after* it.
 * Reversing time must swap which of the two plays first, exactly as it swaps
 * every other pair of points — so point *placement* is done by physically
 * reversing the point array (`points.slice().reverse()`) rather than by
 * mirroring each beat in place and letting a beat-only sort settle the new
 * order. `Array.prototype.sort` is stable: sorting by beat alone leaves tied
 * points in their original relative order, which is correct for every
 * distinct-beat pair (a stable sort never has to break a tie between them)
 * but wrong for a tied pair, and silently so — beats and values still land on
 * some point each, so nothing about the point list looks broken. A full
 * array reversal has no such blind spot: it swaps every pair, tied or not,
 * because it never compares beats at all.
 *
 * Because placement no longer depends on comparing beat values, the mirrored
 * array is already in final sorted order on its own (mirroring is order-
 * reversing, so reversing the array first and then mirroring produces a
 * non-decreasing beat sequence, tied pairs included) — the trailing `.sort`
 * is therefore a defensive no-op, not the mechanism that produces the order.
 *
 * The very last point never owns an outgoing segment, so its curve fields are
 * inert data with nowhere principled to go; they simply ride along to
 * whichever point becomes the new terminal point (the old first point), which
 * is why the very first point in `curveSources` order takes the *last*
 * point's fields unchanged rather than folding into the same formula.
 *
 * The permutation above is exact for the *data* — every field lands back on
 * its original point after a second reverse, ties included, because it is a
 * pure index permutation over the original array and never inspects a beat
 * value to decide where data goes — but data landing on the right point is
 * not the same as the audible shape being a true time-reversal. `linear`,
 * `s-curve`, and `smooth` (Catmull-Rom) satisfy `f(1-t) = 1-f(t)`, so simply
 * relocating the unmodified fields already reproduces the true reversed
 * shape. `bezier` is made exact here by transforming its data: a cubic from
 * `(0,v0)` to `(1,v1)` with controls `C1`,`C2`, traversed backwards, is the
 * cubic from `(0,v1)` to `(1,v0)` with controls `(1-C2.x, C2.y)` and
 * `(1-C1.x, C1.y)` — the two controls swap *and* their `x` mirrors, `y` stays
 * put (see `mirrorBezierTimeAxis`). `exponential`, `step`, and `stairs` are
 * **not** time-symmetric and this permutation only approximates them: a
 * reversed exponential ramp is shaped logarithmically, and
 * `AutomationCurveType` has no `logarithmic` member to hold that; a reversed
 * `step` (or `stairs`) should jump-then-hold (step-then-ramp) at the *start*
 * of the segment, not the end, which the same enum member cannot express
 * either. This is still strictly better than the pre-fix behaviour, where the
 * curve fields did not move with their span at all and an unrelated segment
 * inherited each shape — it is a known, accepted approximation for these
 * three curve types, not a regression.
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

    // Placing points by reversing the array (rather than mirroring each
    // beat in place and sorting) is what makes tied points swap along with
    // everything else — see the doc comment above.
    return points
        .slice()
        .reverse()
        .map((point, position) => {
            const curveSource = curveSources[position]!;
            return {
                ...clonePoint(point),
                beat: minBeat + maxBeat - point.beat,
                curve: curveSource.curve,
                tension: curveSource.tension,
                stairSteps: curveSource.stairSteps,
                cp1: mirrorBezierTimeAxis(curveSource.cp2),
                cp2: mirrorBezierTimeAxis(curveSource.cp1),
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

import { type AutomationPoint } from '../models/Automation';

type PerpendicularDistanceInput = {
    point: Pick<AutomationPoint, 'beat' | 'value'>;
    lineStart: Pick<AutomationPoint, 'beat' | 'value'>;
    lineEnd: Pick<AutomationPoint, 'beat' | 'value'>;
};

function perpendicularDistance({ point, lineStart, lineEnd }: PerpendicularDistanceInput): number {
    const dx = lineEnd.beat - lineStart.beat;
    const dy = lineEnd.value - lineStart.value;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) {
        const dbx = point.beat - lineStart.beat;
        const dby = point.value - lineStart.value;
        return Math.sqrt(dbx * dbx + dby * dby);
    }
    const num = Math.abs(
        dy * point.beat - dx * point.value + lineEnd.beat * lineStart.value - lineEnd.value * lineStart.beat
    );
    return num / Math.sqrt(lengthSq);
}

type SimplifyAutomationPointsInput<Point> = {
    points: Point[];
    tolerance: number;
};

export function simplifyAutomationPoints<Point extends Pick<AutomationPoint, 'beat' | 'value'>>({
    points,
    tolerance,
}: SimplifyAutomationPointsInput<Point>): Point[] {
    if (points.length <= 2) {
        return points;
    }

    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0]!;
    const last = points[points.length - 1]!;

    for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex++) {
        const dist = perpendicularDistance({ point: points[pointIndex]!, lineStart: first, lineEnd: last });
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = pointIndex;
        }
    }

    if (maxDist > tolerance) {
        const left = simplifyAutomationPoints({ points: points.slice(0, maxIdx + 1), tolerance });
        const right = simplifyAutomationPoints({ points: points.slice(maxIdx), tolerance });
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
}

/** Evaluate a cubic Bézier with control values (a, b, c, d) at parameter `s ∈ [0,1]`. */
function cubicBezier(a: number, b: number, c: number, d: number, s: number): number {
    const mt = 1 - s;
    return mt * mt * mt * a + 3 * mt * mt * s * b + 3 * mt * s * s * c + s * s * s * d;
}

/** Derivative of {@link cubicBezier} with respect to `s`. */
function cubicBezierDeriv(a: number, b: number, c: number, d: number, s: number): number {
    const mt = 1 - s;
    return 3 * mt * mt * (b - a) + 6 * mt * s * (c - b) + 3 * s * s * (d - c);
}

type ApplyTensionInput = {
    t: number;
    tension: number;
};

function applyTension({ t, tension }: ApplyTensionInput): number {
    if (Math.abs(tension) < 0.01) {
        return t;
    }
    const power = 2 ** (tension * 3);
    return t ** power;
}

type InterpolateAutomationValueInput = {
    firstPoint: AutomationPoint;
    secondPoint: AutomationPoint;
    beat: number;
    previousPoint?: AutomationPoint;
    nextPoint?: AutomationPoint;
};

export function interpolateAutomationPointValue({
    firstPoint,
    secondPoint,
    beat,
    previousPoint,
    nextPoint,
}: InterpolateAutomationValueInput): number {
    if (secondPoint.beat === firstPoint.beat) {
        return firstPoint.value;
    }

    if (firstPoint.curve === 'step') {
        return firstPoint.value;
    }

    const t = (beat - firstPoint.beat) / (secondPoint.beat - firstPoint.beat);

    if (firstPoint.curve === 'stairs') {
        const steps = firstPoint.stairSteps ?? 4;
        const steppedT = Math.floor(t * steps) / steps;
        return firstPoint.value + (secondPoint.value - firstPoint.value) * steppedT;
    }

    if (firstPoint.curve === 'exponential') {
        const tension = firstPoint.tension ?? 0;
        const expT = applyTension({ t, tension });
        return firstPoint.value + (secondPoint.value - firstPoint.value) * expT;
    }

    if (firstPoint.curve === 's-curve') {
        const tension = firstPoint.tension ?? 0.5;
        const st = t * t * (3 - 2 * t);
        const curved = t + (st - t) * Math.abs(tension);
        return firstPoint.value + (secondPoint.value - firstPoint.value) * curved;
    }

    if (firstPoint.curve === 'smooth') {
        const v0 = previousPoint?.value ?? firstPoint.value;
        const v1 = firstPoint.value;
        const v2 = secondPoint.value;
        const v3 = nextPoint?.value ?? secondPoint.value;

        const t2 = t * t;
        const t3 = t2 * t;

        return (
            0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3)
        );
    }

    if (firstPoint.curve === 'bezier') {
        // Mirror the render path (automationViewHelpers `C ...`): a cubic Bézier
        // whose x control points are fractions of the segment span (defaults
        // 0.33/0.66, matching the renderer) and whose y control points are the
        // normalized control values (defaulting to the segment endpoints).
        // `t` is the fraction along x, but the Bézier is parameterized by its
        // own `s`; solve x(s) === t for `s`, then evaluate y(s). The solve is a
        // fixed-iteration Newton step — no allocation, bounded work (RT-safe).
        const cx1 = firstPoint.cp1?.x ?? 0.33;
        const cx2 = firstPoint.cp2?.x ?? 0.66;
        const cy1 = firstPoint.cp1?.y ?? firstPoint.value;
        const cy2 = firstPoint.cp2?.y ?? secondPoint.value;
        const y0 = firstPoint.value;
        const y3 = secondPoint.value;

        // x(s) has control points (0, cx1, cx2, 1) — endpoints fixed at 0/1.
        // Newton–Raphson on x(s) = t, seeded at s = t; clamp into [0,1].
        let s = t;
        for (let iter = 0; iter < 6; iter++) {
            const xs = cubicBezier(0, cx1, cx2, 1, s) - t;
            if (Math.abs(xs) < 1e-6) {
                break;
            }
            const dx = cubicBezierDeriv(0, cx1, cx2, 1, s);
            if (Math.abs(dx) < 1e-9) {
                break;
            }
            s -= xs / dx;
            if (s < 0) {
                s = 0;
            } else if (s > 1) {
                s = 1;
            }
        }

        return cubicBezier(y0, cy1, cy2, y3, s);
    }

    return firstPoint.value + (secondPoint.value - firstPoint.value) * t;
}

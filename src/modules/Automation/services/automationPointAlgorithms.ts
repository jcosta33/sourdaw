import { evaluateAutomationCurve } from '#/utils/automationCurve';

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

type InterpolateAutomationValueInput = {
    firstPoint: AutomationPoint;
    secondPoint: AutomationPoint;
    beat: number;
    previousPoint?: AutomationPoint;
    nextPoint?: AutomationPoint;
};

/**
 * Value of the live automation curve on [firstPoint, secondPoint] at `beat`.
 *
 * The curve math is the shared {@link evaluateAutomationCurve} kernel in
 * `#/utils/automationCurve` — the single implementation the offline compile
 * path (`compileAutomationEvents`) also routes through. Collapsing the two
 * former copies is finding AU-1's fix: they had drifted on `stairs` clamping
 * and no cross-conformance gate caught it. Do not reintroduce local curve math
 * here; the automation curve-conformance specs guard against re-divergence.
 */
export function interpolateAutomationPointValue({
    firstPoint,
    secondPoint,
    beat,
    previousPoint,
    nextPoint,
}: InterpolateAutomationValueInput): number {
    return evaluateAutomationCurve({ firstPoint, secondPoint, beat, previousPoint, nextPoint });
}

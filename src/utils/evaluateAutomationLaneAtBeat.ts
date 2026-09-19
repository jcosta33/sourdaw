import { evaluateAutomationCurve, type AutomationCurvePoint } from './automationCurve';
import { boundAutomationLaneValue } from './automationLaneBound';
import { resolveLinkedLane } from './automationLaneLink';

export type EvaluatableAutomationLane = {
    id: string;
    linkedLaneId?: string;
    linkScale?: number;
    minValue: number;
    maxValue: number;
    points: readonly AutomationCurvePoint[];
};

type EvaluateAutomationLaneAtBeatInput<Lane extends EvaluatableAutomationLane> = {
    beat: number;
    getLane: (id: string) => Lane | undefined;
    laneId: string;
    resolveLaneCeiling: (lane: Lane) => number;
    resolveLaneDeclaredMax: (lane: Lane) => number;
    visited?: Set<string>;
};

/** Pure lane evaluation shared by live playback and snapshot command admission. */
export function evaluateAutomationLaneAtBeat<Lane extends EvaluatableAutomationLane>({
    beat,
    getLane,
    laneId,
    resolveLaneCeiling,
    resolveLaneDeclaredMax,
    visited,
}: EvaluateAutomationLaneAtBeatInput<Lane>): number | null {
    const resolved = resolveLinkedLane(laneId, getLane, visited);
    if (!resolved) {
        return null;
    }
    const lane = getLane(resolved.sourceLaneId);
    if (!lane || lane.points.length === 0) {
        return null;
    }
    const points = lane.points;
    let lo = 0;
    let hi = points.length - 1;
    let beforeIndex = -1;
    while (lo <= hi) {
        const middle = (lo + hi) >>> 1;
        if (points[middle]!.beat <= beat) {
            beforeIndex = middle;
            lo = middle + 1;
        } else {
            hi = middle - 1;
        }
    }
    const firstIndex = beforeIndex < 0 ? 0 : beforeIndex;
    const secondIndex = beforeIndex < 0 || beforeIndex === points.length - 1 ? firstIndex : beforeIndex + 1;
    const firstPoint = points[firstIndex]!;
    const secondPoint = points[secondIndex]!;
    let value = firstPoint.value;
    if (firstIndex !== secondIndex) {
        value = evaluateAutomationCurve({
            firstPoint,
            secondPoint,
            beat,
            previousPoint: points[firstIndex - 1],
            nextPoint: points[secondIndex + 1],
        });
    }
    return (
        boundAutomationLaneValue({
            value,
            declaredMin: lane.minValue,
            declaredMax: resolveLaneDeclaredMax(lane),
            derivedCeiling: resolveLaneCeiling(lane),
            segmentFirstValue: firstPoint.value,
            segmentSecondValue: secondPoint.value,
        }) * resolved.scale
    );
}

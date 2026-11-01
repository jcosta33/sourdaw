import { type ClipAutomationLaneActionSnapshot } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type AutomationPoint } from '../../models/Automation';
import { is_exact_automation_point, is_sorted_by_beat } from '../../stores/automationStore';

/** Admit only the partial lane captures produced for a clip move. */
export function isExactClipAutomationMoveSnapshots(
    value: unknown
): value is readonly ClipAutomationLaneActionSnapshot[] {
    if (!Array.isArray(value)) {
        return false;
    }
    const snapshots: readonly unknown[] = value;
    const laneIds = new Set<string>();
    for (let laneIndex = 0; laneIndex < snapshots.length; laneIndex += 1) {
        if (!Object.hasOwn(snapshots, laneIndex)) {
            return false;
        }
        const lane: unknown = snapshots[laneIndex];
        if (
            !isRecord(lane) ||
            Object.keys(lane).length !== 3 ||
            !Object.hasOwn(lane, 'id') ||
            !Object.hasOwn(lane, 'trackId') ||
            !Object.hasOwn(lane, 'points') ||
            typeof lane.id !== 'string' ||
            lane.id.length === 0 ||
            laneIds.has(lane.id) ||
            typeof lane.trackId !== 'string' ||
            lane.trackId.length === 0 ||
            !Array.isArray(lane.points)
        ) {
            return false;
        }
        laneIds.add(lane.id);
        const capturedPoints: readonly unknown[] = lane.points;
        const points: AutomationPoint[] = [];
        for (let pointIndex = 0; pointIndex < capturedPoints.length; pointIndex += 1) {
            const point: unknown = capturedPoints[pointIndex];
            if (!Object.hasOwn(capturedPoints, pointIndex) || !is_exact_automation_point(point)) {
                return false;
            }
            points.push(point);
        }
        if (!is_sorted_by_beat(points)) {
            return false;
        }
    }
    return true;
}

import { type AutomationLane, type AutomationPoint, createAutomationLane } from '../models/Automation';

/**
 * Deep-copy a point array so the nested cp1/cp2 control-point objects are never
 * shared by reference between a lane and its duplicate: dragging a control
 * point on the copy must not mutate the source. Absent optionals stay absent —
 * a present `cp1: undefined` key fails the store's exact-shape point check, so
 * a duplicated lane must not mint one.
 */
function copyPoints(points: readonly AutomationPoint[]): AutomationPoint[] {
    return points.map((point) => ({
        ...point,
        ...(point.cp1 === undefined ? {} : { cp1: { ...point.cp1 } }),
        ...(point.cp2 === undefined ? {} : { cp2: { ...point.cp2 } }),
    }));
}

/**
 * One lane copied whole onto a fresh id — the single duplication contract for
 * both clip-duplicate paths (single clip and batch), so a lane field can never
 * again exist on the source yet be dropped from the copy. Optional point arrays
 * stay absent when the source lacks them: presence is meaningful to the store's
 * exact-shape checks. Copied `objects` entries re-pin `laneId` to the fresh
 * lane id — a stale laneId would point into the source lane.
 */
export function buildDuplicatedLane(
    sourceLane: AutomationLane,
    targetTrackId: string,
    targetClipId: string
): AutomationLane {
    const base = createAutomationLane(
        targetTrackId,
        sourceLane.parameterId,
        sourceLane.parameterName,
        sourceLane.minValue,
        sourceLane.maxValue,
        targetClipId
    );
    return {
        ...base,
        points: copyPoints(sourceLane.points),
        objects: sourceLane.objects.map((object) => ({
            ...object,
            laneId: base.id,
            points: copyPoints(object.points),
            ...(object.overrides === undefined ? {} : { overrides: { ...object.overrides } }),
        })),
        visible: sourceLane.visible,
        enabled: sourceLane.enabled,
        collapsed: sourceLane.collapsed,
        ...(sourceLane.linkedLaneId === undefined ? {} : { linkedLaneId: sourceLane.linkedLaneId }),
        ...(sourceLane.linkScale === undefined ? {} : { linkScale: sourceLane.linkScale }),
        ...(sourceLane.viewMinValue === undefined ? {} : { viewMinValue: sourceLane.viewMinValue }),
        ...(sourceLane.viewMaxValue === undefined ? {} : { viewMaxValue: sourceLane.viewMaxValue }),
        ...(sourceLane.color === undefined ? {} : { color: sourceLane.color }),
        ...(sourceLane.clipAutomationMode === undefined ? {} : { clipAutomationMode: sourceLane.clipAutomationMode }),
        ...(sourceLane.trimPoints === undefined ? {} : { trimPoints: copyPoints(sourceLane.trimPoints) }),
        ...(sourceLane.ghostPoints === undefined ? {} : { ghostPoints: copyPoints(sourceLane.ghostPoints) }),
    };
}

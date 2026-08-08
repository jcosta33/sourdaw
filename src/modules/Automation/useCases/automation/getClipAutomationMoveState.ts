import { type ClipAutomationLaneActionSnapshot } from '#/utils/handlerContract';

import { type AutomationPoint } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

type GetClipAutomationMoveStateInput = {
    clipId: string;
    targetTrackId: string;
    beatDelta: number;
};

function clonePoints(points: readonly AutomationPoint[]): AutomationPoint[] {
    return points.map((point) => ({
        ...point,
        ...(point.cp1 ? { cp1: { ...point.cp1 } } : {}),
        ...(point.cp2 ? { cp2: { ...point.cp2 } } : {}),
    }));
}

function sortSnapshots(snapshots: ClipAutomationLaneActionSnapshot[]): ClipAutomationLaneActionSnapshot[] {
    return snapshots.sort((left, right) => left.id.localeCompare(right.id));
}

export function getClipAutomationMoveState({ clipId, targetTrackId, beatDelta }: GetClipAutomationMoveStateInput): {
    previous: ClipAutomationLaneActionSnapshot[];
    next: ClipAutomationLaneActionSnapshot[];
} {
    const clipLanes = (automationStore.value?.lanes ?? []).filter((lane) => lane.clipId === clipId);
    const previous = sortSnapshots(
        clipLanes.map((lane) => ({ id: lane.id, trackId: lane.trackId, points: clonePoints(lane.points) }))
    );
    const next = sortSnapshots(
        clipLanes.map((lane) => ({
            id: lane.id,
            trackId: targetTrackId,
            points: clonePoints(lane.points)
                .map((point) => ({ ...point, beat: Math.max(0, point.beat + beatDelta) }))
                .sort((left, right) => left.beat - right.beat),
        }))
    );
    return { previous, next };
}

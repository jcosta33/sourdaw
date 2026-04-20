import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function duplicateClipAutomation(sourceClipId: string, newClipId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const sourceLanes = state.lanes.filter((l) => l.clipId === sourceClipId);
    if (sourceLanes.length === 0) {
        return;
    }

    const newLanes = sourceLanes
        .map((lane) =>
            createAutomationLane(
                lane.trackId,
                lane.parameterId,
                lane.parameterName,
                lane.minValue,
                lane.maxValue,
                newClipId
            )
        )
        .map((newLane, i) => ({
            ...newLane,
            points: sourceLanes[i]!.points.map((p) => ({ ...p })),
            visible: sourceLanes[i]!.visible,
        }));

    automationStore.set({
        lanes: [...state.lanes, ...newLanes],
    });
}

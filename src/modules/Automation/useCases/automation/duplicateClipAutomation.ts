import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function duplicateClipAutomation(sourceClipId: string, newClipId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const sourceLanes = state.lanes.filter((length) => length.clipId === sourceClipId);
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
        .map((newLane, index) => ({
            ...newLane,
            points: sourceLanes[index]!.points.map((param) => ({ ...param })),
            visible: sourceLanes[index]!.visible,
        }));

    automationStore.set({
        lanes: [...state.lanes, ...newLanes],
    });
}

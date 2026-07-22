import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function addAutomationLane(trackId: string, parameterId: string, parameterName: string, laneId?: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some(
        (lane) =>
            (laneId !== undefined && lane.id === laneId) ||
            (!lane.clipId && lane.trackId === trackId && lane.parameterId === parameterId)
    );
    if (exists) {
        return;
    }

    const lane = createAutomationLane(trackId, parameterId, parameterName);
    automationStore.set({
        lanes: [...state.lanes, laneId === undefined ? lane : { ...lane, id: laneId }],
    });
}

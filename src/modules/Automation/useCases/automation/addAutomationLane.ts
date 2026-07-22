import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function addAutomationLane(trackId: string, parameterId: string, parameterName: string, laneId?: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    let exists: boolean;
    if (laneId === undefined) {
        exists = state.lanes.some(
            (lane) => !lane.clipId && lane.trackId === trackId && lane.parameterId === parameterId
        );
    } else {
        exists = state.lanes.some((lane) => lane.id === laneId);
    }
    if (exists) {
        return;
    }

    const lane = createAutomationLane(trackId, parameterId, parameterName);
    automationStore.set({
        lanes: [...state.lanes, laneId === undefined ? lane : { ...lane, id: laneId }],
    });
}

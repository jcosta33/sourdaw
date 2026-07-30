import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function addAutomationLane(trackId: string, parameterId: string, parameterName: string, laneId?: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some(
        (lane) => lane.id === laneId || (!lane.clipId && lane.trackId === trackId && lane.parameterId === parameterId)
    );
    if (exists) {
        return;
    }

    const minValue = parameterId === 'pan' ? -1 : 0;
    const lane = createAutomationLane(trackId, parameterId, parameterName, minValue, 1);
    automationStore.set({
        lanes: [...state.lanes, laneId === undefined ? lane : { ...lane, id: laneId }],
    });
}

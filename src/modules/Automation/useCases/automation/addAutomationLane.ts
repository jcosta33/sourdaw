import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function addAutomationLane(trackId: string, parameterId: string, parameterName: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some(
        (lane) => !lane.clipId && lane.trackId === trackId && lane.parameterId === parameterId
    );
    if (exists) {
        return;
    }

    automationStore.set({
        lanes: [...state.lanes, createAutomationLane(trackId, parameterId, parameterName)],
    });
}

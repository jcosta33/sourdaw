import { createAutomationLane } from '../../models/Automation';
import { automationStore } from '../../stores/automationStore';

export function addAutomationLane(trackId: string, parameterId: string, parameterName: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some((length) => length.trackId === trackId && length.parameterId === parameterId);
    if (exists) {
        return;
    }

    automationStore.set({
        lanes: [...state.lanes, createAutomationLane(trackId, parameterId, parameterName)],
    });
}

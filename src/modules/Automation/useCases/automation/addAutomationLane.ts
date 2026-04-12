import { automationStore } from '../../stores/automationStore';
import { createAutomationLane } from '../../models/Automation';

export function addAutomationLane(trackId: string, parameterId: string, parameterName: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some((l) => l.trackId === trackId && l.parameterId === parameterId);
    if (exists) {
        return;
    }

    automationStore.set({
        lanes: [...state.lanes, createAutomationLane(trackId, parameterId, parameterName)],
    });
}

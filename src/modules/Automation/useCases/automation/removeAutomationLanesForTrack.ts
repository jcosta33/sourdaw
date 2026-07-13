import { automationStore } from '../../stores/automationStore';

export function removeAutomationLanesForTrack(trackId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lanes = state.lanes.filter((lane) => lane.trackId !== trackId);
    if (lanes.length === state.lanes.length) {
        return;
    }

    automationStore.set({
        lanes,
    });
}

import { automationStore } from '../../stores/automationStore';

export function removeAutomationLanesForTrack(trackId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    automationStore.set({
        lanes: state.lanes.filter((lane) => lane.trackId !== trackId),
    });
}

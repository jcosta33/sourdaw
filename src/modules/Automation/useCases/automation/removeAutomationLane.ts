import { automationStore } from '../../stores/automationStore';

export function removeAutomationLane(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.filter((l) => l.id !== laneId),
    });
}

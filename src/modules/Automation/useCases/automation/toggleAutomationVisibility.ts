import { automationStore } from '../../stores/automationStore';

export function toggleAutomationVisibility(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, visible: !l.visible } : l)),
    });
}

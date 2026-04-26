import { automationStore } from '../../stores/automationStore';

export function toggleAutomationVisibility(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) => (length.id === laneId ? { ...length, visible: !length.visible } : length)),
    });
}

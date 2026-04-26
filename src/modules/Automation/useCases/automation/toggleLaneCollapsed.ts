import { automationStore } from '../../stores/automationStore';

export function toggleLaneCollapsed(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((length) =>
            length.id === laneId ? { ...length, collapsed: !length.collapsed } : length
        ),
    });
}

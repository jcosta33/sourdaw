import { automationStore } from '#/modules/Automation/stores/automationStore';

export function toggleLaneCollapsed(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, collapsed: !l.collapsed } : l)),
    });
}

import { automationStore } from '../../stores/automationStore';

export function removeSendAutomationRange(laneIds: readonly string[]): boolean {
    const state = automationStore.value;
    if (!state) {
        return false;
    }
    const targetIds = new Set(laneIds);
    automationStore.set({ lanes: state.lanes.filter((lane) => !targetIds.has(lane.id)) });
    return true;
}

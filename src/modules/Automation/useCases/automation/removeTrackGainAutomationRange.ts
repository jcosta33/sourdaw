import { automationStore } from '../../stores/automationStore';

export function removeTrackGainAutomationRange(laneIds: readonly string[]): boolean {
    const state = automationStore.value;
    if (!state) {
        return false;
    }
    const laneIdSet = new Set(laneIds);
    const lanes = state.lanes.filter((lane) => !laneIdSet.has(lane.id));
    if (state.lanes.length - lanes.length !== laneIdSet.size) {
        return false;
    }
    automationStore.set({ lanes });
    return true;
}

import { automationStore } from '../../stores/automationStore';

type SetAutomationLaneEnabledInput = {
    laneId: string;
    enabled: boolean;
};

export function setAutomationLaneEnabled({ laneId, enabled }: SetAutomationLaneEnabledInput): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    const lane = state.lanes.find((candidate) => candidate.id === laneId);
    if (!lane || lane.enabled === enabled) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((candidate) => (candidate.id === laneId ? { ...candidate, enabled } : candidate)),
    });
}

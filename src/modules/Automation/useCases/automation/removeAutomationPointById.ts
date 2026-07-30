import { automationStore } from '../../stores/automationStore';

export function removeAutomationPointById(laneId: string, pointId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    const lane = state.lanes.find((candidate) => candidate.id === laneId);
    if (!lane?.points.some((point) => point.id === pointId)) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((candidate) => {
            if (candidate.id !== laneId) {
                return candidate;
            }
            return { ...candidate, points: candidate.points.filter((point) => point.id !== pointId) };
        }),
    });
}

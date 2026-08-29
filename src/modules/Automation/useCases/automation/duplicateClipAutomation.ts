import { buildDuplicatedLane } from '../../services/buildDuplicatedLane';
import { automationStore } from '../../stores/automationStore';

export function duplicateClipAutomation(sourceClipId: string, newClipId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const sourceLanes = state.lanes.filter((lane) => lane.clipId === sourceClipId);
    if (sourceLanes.length === 0) {
        return;
    }

    const newLanes = sourceLanes.map((lane) => buildDuplicatedLane(lane, lane.trackId, newClipId));

    automationStore.set({
        lanes: [...state.lanes, ...newLanes],
    });
}

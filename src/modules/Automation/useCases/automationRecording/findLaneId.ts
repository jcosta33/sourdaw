import { automationStore } from '../../stores/automationStore';

export function findLaneId(trackId: string, parameterId: string): string | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }
    const lane = state.lanes.find(
        (candidate) => candidate.trackId === trackId && candidate.parameterId === parameterId
    );
    return lane?.id ?? null;
}

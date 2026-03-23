import { takeLaneStore } from '#/modules/Clip/stores/takeLaneStore';
import { createTakeLane } from '#/modules/Clip/models/TakeLane';

export function addTakeLane(trackId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some((l) => l.trackId === trackId);
    if (exists) {
        return;
    }

    takeLaneStore.set({
        lanes: [...state.lanes, createTakeLane(trackId)],
    });
}

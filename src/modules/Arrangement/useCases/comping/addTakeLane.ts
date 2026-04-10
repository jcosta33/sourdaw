import { inject } from '#/infra/di/inject';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { createTakeLane } from '#/modules/Arrangement/models/TakeLane';

export const addTakeLane = inject({ takeLaneStore })(({ takeLaneStore: store }) => {
    return function addTakeLane(trackId: string): void {
        const state = store.value;
        if (!state) {
            return;
        }

        const exists = state.lanes.some((l) => l.trackId === trackId);
        if (exists) {
            return;
        }

        store.set({
            lanes: [...state.lanes, createTakeLane(trackId)],
        });
    };
});

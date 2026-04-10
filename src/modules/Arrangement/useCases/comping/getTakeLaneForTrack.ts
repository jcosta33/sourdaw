import { inject } from '#/infra/di/inject';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { type TakeLane } from '#/modules/Arrangement/models/TakeLane';

export const getTakeLaneForTrack = inject({ takeLaneStore })(({ takeLaneStore: store }) => {
    return function getTakeLaneForTrack(trackId: string): TakeLane | null {
        const state = store.value;
        if (!state) {
            return null;
        }
        return state.lanes.find((l) => l.trackId === trackId) ?? null;
    };
});

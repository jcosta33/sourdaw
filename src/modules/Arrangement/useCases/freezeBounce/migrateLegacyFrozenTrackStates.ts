import { trackStore } from '../../stores/trackStore';

export function migrateLegacyFrozenTrackStates(): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    const tracks = state.tracks.map((track) => {
        if (
            track.freezeState.status !== 'frozen' ||
            track.freezeState.sourceContentHash?.startsWith('freeze-v2:') === true
        ) {
            return track;
        }
        return {
            ...track,
            freezeState: {
                ...track.freezeState,
                status: 'stale' as const,
            },
        };
    });
    if (tracks.some((track, index) => track !== state.tracks[index])) {
        trackStore.set({ ...state, tracks });
    }
}

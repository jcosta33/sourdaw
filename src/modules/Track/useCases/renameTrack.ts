import { trackStore } from "../stores/trackStore";

export const renameTrack = (trackId: string, name: string): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, name } : t,
        ),
    });
};

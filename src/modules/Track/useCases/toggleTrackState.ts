import { trackStore } from "../stores/trackStore";

export const muteTrack = (trackId: string, muted: boolean): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, muted } : t,
        ),
    });
};

export const soloTrack = (trackId: string, soloed: boolean): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, soloed } : t,
        ),
    });
};

export const selectTrack = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({ ...state, selectedTrackId: trackId });
};

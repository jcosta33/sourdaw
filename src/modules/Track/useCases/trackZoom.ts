import { trackStore } from "../stores/trackStore";

export const zoomTracksVertical = (delta: number): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            height: Math.max(30, Math.min(300, (t.height ?? 64) + delta)),
        })),
    });
};

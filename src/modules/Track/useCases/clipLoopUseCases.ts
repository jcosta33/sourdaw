import { trackStore } from "../stores/trackStore";

export const setClipLoop = (clipId: string, enabled: boolean): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId ? { ...c, loopEnabled: enabled } : c,
            ),
        })),
    });
};

export const setClipLoopLength = (clipId: string, loopLength: number): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    if (loopLength <= 0) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId ? { ...c, loopLength } : c,
            ),
        })),
    });
};

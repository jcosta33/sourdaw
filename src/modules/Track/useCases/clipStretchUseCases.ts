import { trackStore } from "../stores/trackStore";
import type { StretchMode } from "../models/Track";

const MIN_RATIO = 0.25;
const MAX_RATIO = 4.0;

const clampRatio = (ratio: number): number =>
    Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

export const setClipStretchMode = (clipId: string, mode: StretchMode): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId ? { ...c, stretchMode: mode } : c,
            ),
        })),
    });
};

export const setClipStretchRatio = (clipId: string, ratio: number): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const clamped = clampRatio(ratio);

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => {
                if (c.id !== clipId) {
                    return c;
                }

                const updated = { ...c, stretchRatio: clamped };

                if (c.stretchMode === "repitch") {
                    const originalDuration = c.endBeat - c.startBeat;
                    const previousRatio = c.stretchRatio ?? 1;
                    const baseDuration = originalDuration * previousRatio;
                    updated.endBeat = c.startBeat + baseDuration / clamped;
                }

                return updated;
            }),
        })),
    });
};

export const fitClipToBeats = (clipId: string, targetBeats: number): void => {
    const state = trackStore.value;
    if (!state || targetBeats <= 0) {
        return;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (!clip) {
            continue;
        }

        const currentDuration = clip.endBeat - clip.startBeat;
        const previousRatio = clip.stretchRatio ?? 1;
        const baseDuration = currentDuration * previousRatio;
        const newRatio = clampRatio(baseDuration / targetBeats);

        trackStore.set({
            ...state,
            tracks: state.tracks.map((t) => ({
                ...t,
                clips: t.clips.map((c) => {
                    if (c.id !== clipId) {
                        return c;
                    }
                    return {
                        ...c,
                        stretchRatio: newRatio,
                        stretchMode: c.stretchMode === "off" ? "repitch" as const : c.stretchMode,
                        endBeat: c.startBeat + targetBeats,
                    };
                }),
            })),
        });
        return;
    }
};

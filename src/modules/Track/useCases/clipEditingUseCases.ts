import { trackStore } from "../stores/trackStore";
import type { Clip } from "../models/Track";

let nextClipId = 1000;

export const splitClip = (clipId: string, splitBeat: number): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            const clip = t.clips.find((c) => c.id === clipId);
            if (!clip || splitBeat <= clip.startBeat || splitBeat >= clip.endBeat) return t;

            const leftClip: Clip = {
                ...clip,
                endBeat: splitBeat,
                name: `${clip.name} (L)`,
            };

            const rightClip: Clip = {
                id: `clip-${nextClipId++}`,
                trackId: t.id,
                name: `${clip.name} (R)`,
                startBeat: splitBeat,
                endBeat: clip.endBeat,
                type: clip.type,
            };

            return {
                ...t,
                clips: t.clips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
            };
        }),
    });
};

export const trimClipStart = (clipId: string, newStartBeat: number): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId && newStartBeat < c.endBeat
                    ? { ...c, startBeat: Math.max(0, newStartBeat) }
                    : c,
            ),
        })),
    });
};

export const trimClipEnd = (clipId: string, newEndBeat: number): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                c.id === clipId && newEndBeat > c.startBeat
                    ? { ...c, endBeat: newEndBeat }
                    : c,
            ),
        })),
    });
};

export const resizeClip = (clipId: string, factor: number): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => {
                if (c.id !== clipId) return c;
                const duration = c.endBeat - c.startBeat;
                return { ...c, endBeat: c.startBeat + duration * factor };
            }),
        })),
    });
};

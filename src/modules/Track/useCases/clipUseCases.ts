import { trackStore } from "../stores/trackStore";
import type { Clip } from "../models/Track";

let nextClipId = 1;

export const addClip = (input: {
    trackId: string;
    startBeat: number;
    endBeat: number;
    name: string;
    type?: "audio" | "midi";
}): Clip | null => {
    const state = trackStore.value;
    if (!state) return null;

    const clip: Clip = {
        id: `clip-${nextClipId++}`,
        trackId: input.trackId,
        name: input.name,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: input.type ?? "audio",
    };

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === input.trackId
                ? { ...t, clips: [...t.clips, clip] }
                : t,
        ),
    });

    return clip;
};

export const removeClip = (clipId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            clips: t.clips.filter((c) => c.id !== clipId),
        })),
    });
};

export const moveClip = (clipId: string, targetTrackId: string, startBeat: number): void => {
    const state = trackStore.value;
    if (!state) return;

    let movedClip: Clip | undefined;
    const tracksWithoutClip = state.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId);
        if (clip) {
            movedClip = { ...clip, trackId: targetTrackId, startBeat, endBeat: startBeat + (clip.endBeat - clip.startBeat) };
        }
        return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
    });

    if (!movedClip) return;

    trackStore.set({
        ...state,
        tracks: tracksWithoutClip.map((t) =>
            t.id === targetTrackId
                ? { ...t, clips: [...t.clips, movedClip!] }
                : t,
        ),
    });
};

export const duplicateClip = (clipId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            const duration = clip.endBeat - clip.startBeat;
            addClip({
                trackId: track.id,
                startBeat: clip.endBeat,
                endBeat: clip.endBeat + duration,
                name: `${clip.name} (copy)`,
                type: clip.type,
            });
            return;
        }
    }
};

import { trackStore } from "../stores/trackStore";
import type { Clip } from "../models/Track";
import { shiftClipAutomation, duplicateClipAutomation } from "#/modules/Track/useCases/automationUseCases";
import { transportStore } from "#/modules/Transport/stores/transportStore";

let nextClipId = 1;

export const addClip = (input: {
    trackId: string;
    startBeat: number;
    endBeat: number;
    name: string;
    type?: "audio" | "midi";
    audioBufferId?: string;
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
        audioBufferId: input.audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: "",
        locked: false,
        muted: false,
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
    if (!state) {
        return;
    }

    let movedClip: Clip | undefined;
    let oldStartBeat: number | undefined;
    const tracksWithoutClip = state.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId);
        if (clip) {
            oldStartBeat = clip.startBeat;
            movedClip = { ...clip, trackId: targetTrackId, startBeat, endBeat: startBeat + (clip.endBeat - clip.startBeat) };
        }
        return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
    });

    if (!movedClip || oldStartBeat === undefined) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: tracksWithoutClip.map((t) =>
            t.id === targetTrackId
                ? { ...t, clips: [...t.clips, movedClip!] }
                : t,
        ),
    });

    const beatDelta = startBeat - oldStartBeat;
    if (beatDelta !== 0) {
        shiftClipAutomation(clipId, beatDelta);
    }
};

export const moveClipPreview = (clipId: string, targetTrackId: string, startBeat: number): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    let movedClip: Clip | undefined;
    let oldStartBeat: number | undefined;
    const tracksWithoutClip = state.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId);
        if (clip) {
            oldStartBeat = clip.startBeat;
            movedClip = { ...clip, trackId: targetTrackId, startBeat, endBeat: startBeat + (clip.endBeat - clip.startBeat) };
        }
        return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
    });

    if (!movedClip || oldStartBeat === undefined) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: tracksWithoutClip.map((t) =>
            t.id === targetTrackId
                ? { ...t, clips: [...t.clips, movedClip!] }
                : t,
        ),
    });

    const beatDelta = startBeat - oldStartBeat;
    if (beatDelta !== 0) {
        shiftClipAutomation(clipId, beatDelta);
    }
};

export const duplicateClip = (clipId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            const duration = clip.endBeat - clip.startBeat;
            const newClip = addClip({
                trackId: track.id,
                startBeat: clip.endBeat,
                endBeat: clip.endBeat + duration,
                name: `${clip.name} (copy)`,
                type: clip.type,
                audioBufferId: clip.audioBufferId,
            });

            if (newClip) {
                duplicateClipAutomation(clipId, newClip.id);
            }
            return;
        }
    }
};

export const duplicateClipToNextBar = (clipId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const transport = transportStore.value;
    const beatsPerBar = transport?.timeSignatureNumerator ?? 4;

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            const duration = clip.endBeat - clip.startBeat;
            const nextBarStart = Math.ceil(clip.endBeat / beatsPerBar) * beatsPerBar;
            const newClip = addClip({
                trackId: track.id,
                startBeat: nextBarStart,
                endBeat: nextBarStart + duration,
                name: `${clip.name} (copy)`,
                type: clip.type,
                audioBufferId: clip.audioBufferId,
            });

            if (newClip) {
                duplicateClipAutomation(clipId, newClip.id);
            }
            return;
        }
    }
};

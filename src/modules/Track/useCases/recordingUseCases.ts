import { trackStore } from "../stores/trackStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import type { Clip } from "../models/Track";

let recordClipId = 1;

export const armTrack = (trackId: string, armed: boolean): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, armed } : t,
        ),
    });
};

export const startRecording = (): Clip[] => {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    if (!trackState || !transportState) return [];

    const armedTracks = trackState.tracks.filter((t) => t.armed);
    const newClips: Clip[] = [];

    for (const track of armedTracks) {
        const clip: Clip = {
            id: `rec-clip-${recordClipId++}`,
            trackId: track.id,
            name: `Recording ${recordClipId}`,
            startBeat: transportState.playheadPosition,
            endBeat: transportState.playheadPosition,
            type: track.kind === "midi" ? "midi" : "audio",
        };
        newClips.push(clip);
    }

    if (newClips.length > 0) {
        trackStore.set({
            ...trackState,
            tracks: trackState.tracks.map((t) => {
                const clip = newClips.find((c) => c.trackId === t.id);
                if (!clip) return t;
                return { ...t, clips: [...t.clips, clip] };
            }),
        });
    }

    return newClips;
};

export const stopRecording = (clipIds: string[]): void => {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    if (!trackState || !transportState) return;

    trackStore.set({
        ...trackState,
        tracks: trackState.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                clipIds.includes(c.id)
                    ? { ...c, endBeat: Math.max(c.startBeat + 1, transportState.playheadPosition) }
                    : c,
            ),
        })),
    });
};

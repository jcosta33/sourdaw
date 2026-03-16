import { trackStore } from "../stores/trackStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { takeLaneStore } from "../stores/takeLaneStore";
import type { Clip } from "../models/Track";
import { addTakeLane, addTake, getTakeLaneForTrack } from "./compingUseCases";
import { setMidiInputTrack } from "#/modules/AudioEngine/useCases/webMidiInput";

let recordClipId = 1;
let takeCounter = 1;

export const armTrack = (trackId: string, armed: boolean): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, armed } : t,
        ),
    });

    if (armed) {
        const track = state.tracks.find((t) => t.id === trackId);
        if (track && track.kind === "midi") {
            setMidiInputTrack(trackId);
        }
    }
};

export const startRecording = (): Clip[] => {
    const trackState = trackStore.value;
    const transportState = transportStore.value;
    if (!trackState || !transportState) return [];

    const armedTracks = trackState.tracks.filter((t) => t.armed);
    const newClips: Clip[] = [];

    for (const track of armedTracks) {
        const clipId = `rec-clip-${recordClipId++}`;
        const clip: Clip = {
            id: clipId,
            trackId: track.id,
            name: `Recording ${recordClipId}`,
            startBeat: transportState.playheadPosition,
            endBeat: transportState.playheadPosition,
            type: track.kind === "midi" ? "midi" : "audio",
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1.0,
            color: "",
            locked: false,
            muted: false,
        };
        newClips.push(clip);

        if (!getTakeLaneForTrack(track.id)) {
            addTakeLane(track.id);
        }
        addTake(
            track.id,
            clipId,
            `Take ${takeCounter++}`,
            transportState.playheadPosition,
            transportState.playheadPosition,
        );
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

    const endBeat = transportState.playheadPosition;

    trackStore.set({
        ...trackState,
        tracks: trackState.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
                clipIds.includes(c.id)
                    ? { ...c, endBeat: Math.max(c.startBeat + 1, endBeat) }
                    : c,
            ),
        })),
    });

    const tlState = takeLaneStore.value;
    if (tlState) {
        takeLaneStore.set({
            lanes: tlState.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) =>
                    clipIds.includes(take.clipId)
                        ? { ...take, endBeat: Math.max(take.startBeat + 1, endBeat) }
                        : take,
                ),
            })),
        });
    }
};

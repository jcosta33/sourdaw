import { trackStore } from "../stores/trackStore";
import type { Clip } from "../models/Track";

let frozenClipId = 1;

export const freezeTrack = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) return t;
            return {
                ...t,
                frozen: true,
                devices: t.devices.map((d) => ({ ...d, bypassed: true })),
            };
        }),
    });
};

export const unfreezeTrack = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) return t;
            return {
                ...t,
                frozen: false,
                devices: t.devices.map((d) => ({ ...d, bypassed: false })),
            };
        }),
    });
};

export const bounceInPlace = (trackId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) return;

    const startBeat = Math.min(...track.clips.map((c) => c.startBeat));
    const endBeat = Math.max(...track.clips.map((c) => c.endBeat));

    const bouncedClip: Clip = {
        id: `frozen-clip-${frozenClipId++}`,
        trackId,
        name: `${track.name} (bounced)`,
        startBeat,
        endBeat,
        type: "audio",
    };

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) return t;
            return {
                ...t,
                clips: [bouncedClip],
                devices: [],
            };
        }),
    });
};

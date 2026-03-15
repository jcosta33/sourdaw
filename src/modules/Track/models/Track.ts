export type TrackKind = "audio" | "midi" | "bus" | "master" | "folder";

export type Track = {
    id: string;
    name: string;
    kind: TrackKind;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    color: string;
    clips: Clip[];
    devices: Device[];
    sends: Send[];
    frozen: boolean;
    parentId: string | null;
    collapsed: boolean;
};

export type Clip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: "audio" | "midi";
};

export type Device = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
};

export type Send = {
    busId: string;
    level: number;
};

const TRACK_COLORS: Record<TrackKind, string> = {
    audio: "oklch(0.65 0.15 145)",
    midi: "oklch(0.65 0.15 260)",
    bus: "oklch(0.65 0.15 50)",
    master: "oklch(0.65 0.15 0)",
    folder: "oklch(0.65 0.08 200)",
};

let nextTrackId = 1;

export const createTrack = (input: { name: string; kind: TrackKind; parentId?: string }): Track => ({
    id: `track-${nextTrackId++}`,
    name: input.name,
    kind: input.kind,
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: TRACK_COLORS[input.kind],
    clips: [],
    devices: [],
    sends: [],
    frozen: false,
    parentId: input.parentId ?? null,
    collapsed: false,
});

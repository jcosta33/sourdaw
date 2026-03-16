export type ProjectContext = {
    tempo: number;
    timeSignature: [number, number];
    tracks: ProjectContextTrack[];
    selectedTrackId: string | null;
    selectedClipId: string | null;
    selectedClipIds: string[];
    activeView: "arrange" | "clip" | "mix";
    playheadPosition: number;
};

export type ProjectContextClip = {
    id: string;
    name: string;
    type: "audio" | "midi";
    startBeat: number;
    endBeat: number;
    noteCount: number;
};

export type ProjectContextDevice = {
    id: string;
    type: string;
    bypassed: boolean;
};

export type ProjectContextTrack = {
    id: string;
    name: string;
    kind: string;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    clipCount: number;
    deviceCount: number;
    clips: ProjectContextClip[];
    devices: ProjectContextDevice[];
};

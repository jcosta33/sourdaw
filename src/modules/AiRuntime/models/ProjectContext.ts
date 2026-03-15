export type ProjectContext = {
    tempo: number;
    timeSignature: [number, number];
    tracks: ProjectContextTrack[];
    selectedTrackId: string | null;
    selectedClipId: string | null;
    activeView: "arrange" | "clip" | "mix";
    playheadPosition: number;
};

export type ProjectContextTrack = {
    id: string;
    name: string;
    kind: string;
    muted: boolean;
    soloed: boolean;
};

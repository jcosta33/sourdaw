export type TimelineRenderModel = {
    tracks: TrackRenderModel[];
    selectedTrackId: string | null;
    selectedClipId: string | null;
    selectedClipIds: string[];
    playheadPosition: number;
    viewportStartBeat: number;
    viewportEndBeat: number;
    beatsPerPixel: number;
    pixelsPerBeat: number;
    trackHeight: number;
    scrollY: number;
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
};

export type TrackRenderModel = {
    id: string;
    name: string;
    index: number;
    kind: "audio" | "midi" | "bus" | "master" | "folder";
    color: string;
    muted: boolean;
    soloed: boolean;
    height: number;
    clips: ClipRenderModel[];
};

export type MiniNoteRenderModel = {
    pitch: number;
    startBeat: number;
    duration: number;
};

export type ClipRenderModel = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
    type: "audio" | "midi";
    muted: boolean;
    midiNotes: MiniNoteRenderModel[];
    audioBufferId?: string;
    loopEnabled?: boolean;
    loopLength?: number;
    fadeInBeats: number;
    fadeOutBeats: number;
};

export const createDefaultTimelineRenderModel = (): TimelineRenderModel => ({
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    playheadPosition: 0,
    viewportStartBeat: 0,
    viewportEndBeat: 64,
    beatsPerPixel: 0.1,
    pixelsPerBeat: 10,
    trackHeight: 64,
    scrollY: 0,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
});

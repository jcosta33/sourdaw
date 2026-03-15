export type TimelineRenderModel = {
    tracks: TrackRenderModel[];
    playheadPosition: number;
    viewportStartBeat: number;
    viewportEndBeat: number;
    beatsPerPixel: number;
    pixelsPerBeat: number;
    trackHeight: number;
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
};

export type TrackRenderModel = {
    id: string;
    name: string;
    index: number;
    kind: "audio" | "midi" | "bus" | "master" | "folder";
    muted: boolean;
    soloed: boolean;
    clips: ClipRenderModel[];
};

export type ClipRenderModel = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
};

export const createDefaultTimelineRenderModel = (): TimelineRenderModel => ({
    tracks: [],
    playheadPosition: 0,
    viewportStartBeat: 0,
    viewportEndBeat: 64,
    beatsPerPixel: 0.1,
    pixelsPerBeat: 10,
    trackHeight: 64,
    tempo: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
});

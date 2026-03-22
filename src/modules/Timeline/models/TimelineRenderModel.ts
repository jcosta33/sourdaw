export type TimelineRenderModel = {
    dataDirty: boolean;
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
    automationVisible: boolean;
};

export type TrackRenderModel = {
    id: string;
    name: string;
    index: number;
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
    color: string;
    muted: boolean;
    soloed: boolean;
    height: number;
    clips: ClipRenderModel[];
    automationSubLaneCount: number;
    automationMode: 'read' | 'write' | 'touch' | 'latch' | 'off';
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
    type: 'audio' | 'midi';
    muted: boolean;
    midiNotes: MiniNoteRenderModel[];
    audioBufferId?: string;
    loopEnabled?: boolean;
    loopLength?: number;
    fadeInBeats: number;
    fadeOutBeats: number;
    generating?: boolean;
    isGhost?: boolean;
};

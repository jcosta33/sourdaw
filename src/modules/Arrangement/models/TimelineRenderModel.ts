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
    /** Beats into the audio buffer at which playback starts. Needed by the
     *  waveform renderer so that trimmed or split clips show the correct
     *  portion of the underlying sample instead of the whole buffer. */
    audioOffsetBeats?: number;
    /** Tempo/stretch factor. `1.0` plays at native rate; `0.5` plays at half
     *  speed (so twice as many buffer samples are consumed per beat). */
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    fadeInBeats: number;
    fadeOutBeats: number;
    generating?: boolean;
    isGhost?: boolean;
    isLinkedInstance?: boolean;
};

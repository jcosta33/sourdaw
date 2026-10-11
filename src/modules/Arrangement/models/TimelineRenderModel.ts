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
    /** Immutable tempo-map snapshot used with `tempo` for waveform song-time mapping. */
    tempoChanges?: readonly { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }[];
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
    /** H3: Visible alternative lanes */
    variationLanes?: {
        id: string;
        name: string;
        clips: ClipRenderModel[];
    }[];
    automationMode: 'read' | 'write' | 'touch' | 'latch' | 'off';
};

export type MiniNoteRenderModel = {
    id: string;
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
    /** Authoritative signed media entry, including zero. */
    audioOffsetSeconds?: number;
    /** Tempo governing this clip's source offset, which may differ from the project base tempo. */
    clipStartTempo?: number;
    /** Source seconds consumed per destination second when stretch is enabled. */
    stretchRatio?: number;
    stretchMode?: 'off' | 'repitch' | 'timestretch';
    loopEnabled?: boolean;
    loopLength?: number;
    midiOffsetBeats?: number;
    fadeInBeats: number;
    fadeOutBeats: number;
    generating?: boolean;
    isGhost?: boolean;
    isLinkedInstance?: boolean;
    isInlineEditing?: boolean;
};

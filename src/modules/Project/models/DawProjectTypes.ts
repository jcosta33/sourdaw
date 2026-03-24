export type DawProjectTrack = {
    id: string;
    name: string;
    type: 'audio' | 'midi' | 'bus' | 'master';
    color: string;
    volume: number;
    pan: number;
    muted: boolean;
    solo: boolean;
};

export type DawProjectClip = {
    trackId: string;
    name: string;
    startBeat: number;
    durationBeats: number;
    /** Reference to media file (relative path inside ZIP) */
    mediaRef: string | null;
    /** MIDI notes if MIDI clip */
    notes: Array<{ pitch: number; velocity: number; startBeat: number; durationBeats: number }>;
};

export type DawProjectTimeline = {
    bpm: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
};

export type DawProjectDocument = {
    version: string;
    application: string;
    timeline: DawProjectTimeline;
    tracks: DawProjectTrack[];
    clips: DawProjectClip[];
};

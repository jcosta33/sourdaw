export type DawProjectAudioAsset = {
    path: string;
    bytes: Uint8Array;
};

export type DawProjectParsedTrack = {
    id: string;
    name: string;
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
    color: string;
    parentId: string | null;
    volume: number;
    pan: number;
    mute: boolean;
    solo: boolean;
    clips: DawProjectParsedClip[];
    deviceTypes: string[];
};

export type DawProjectParsedMidiNote = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

export type DawProjectParsedClip = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    audioAssetPath?: string;
    notes?: DawProjectParsedMidiNote[];
};

export type DawProjectTempoChange = {
    beat: number;
    tempo: number;
};

export type DawProjectTimeSignatureChange = {
    beat: number;
    numerator: number;
    denominator: number;
};

export type DawProjectMarker = {
    beat: number;
    name: string;
};

export type DawProjectMeta = {
    title: string;
    artist: string;
    comment: string;
};

export type DawProjectParseResult = {
    meta: DawProjectMeta;
    initialTempo: number;
    initialTimeSignature: { numerator: number; denominator: number };
    tempoChanges: DawProjectTempoChange[];
    timeSignatureChanges: DawProjectTimeSignatureChange[];
    tracks: DawProjectParsedTrack[];
    markers: DawProjectMarker[];
    audioAssets: Map<string, Uint8Array>;
};

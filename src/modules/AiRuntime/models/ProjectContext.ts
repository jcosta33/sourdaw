export type ProjectContext = {
    tempo: number;
    timeSignature: [number, number];
    tracks: ProjectContextTrack[];
    selectedTrackId: string | null;
    selectedClipId: string | null;
    selectedClipIds: string[];
    activeView: 'arrange' | 'automation' | 'clip' | 'mix';
    playheadPosition: number;
};

export type ProjectContextClip = {
    id: string;
    name: string;
    type: 'audio' | 'midi';
    startBeat: number;
    endBeat: number;
    noteCount: number;
};

export type ProjectContextDevice = {
    id: string;
    type: string;
    bypassed: boolean;
    parameters?: ProjectContextDeviceParameter[];
};

export type ProjectContextDeviceParameter = {
    id: string;
    name: string;
    type: 'float' | 'int' | 'bool' | 'choice';
    value: number;
    minValue: number;
    maxValue: number;
    unit: string;
    choices?: string[];
};

export type ProjectContextSend = {
    busId: string;
    level: number;
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
    sends?: ProjectContextSend[];
};

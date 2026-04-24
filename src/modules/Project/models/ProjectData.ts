/**
 * Canonical Project Data Schema
 *
 * This file defines the serializable JSON schema for .sourdaw files.
 * It mirrors the domain models (Track, Clip, Automation) but ensures
 * everything is a plain object with no class methods or engine refs.
 */

export type ProjectData = {
    version: number;
    meta: ProjectMeta;
    transport: ProjectTransport;
    arrangement: ProjectArrangement;
    automation: ProjectAutomation;
    midi: ProjectMidi;
    mixer: ProjectMixer;
    markers: ProjectMarker[];
    tempoMap?: ProjectTempoMap;
    timeSignatureMap?: ProjectTimeSignatureMap;
    takeLanes?: ProjectTakeLaneStoreState;
    sidechainRoutes?: ProjectSidechainRoute[];
    arrangements?: ProjectArrangementSnapshot[];
    activeArrangementId?: string;
    audioBuffers?: Record<string, ProjectExportedAudioBuffer>;
    history: ProjectHistory;
};

export type ProjectMeta = {
    name: string;
    createdAt: number;
    updatedAt: number;
    keyRoot: number;
    scaleName: string;
    tuning: {
        name: string;
        frequencies: number[];
    };
};

export type ProjectTransport = {
    tempo: number;
    timeSignatureNumerator: number;
    timeSignatureDenominator: number;
    loopStart: number;
    loopEnd: number;
    isLooping: boolean;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    punchInEnabled: boolean;
    punchInBeat: number;
    punchOutBeat: number;
    countInEnabled: boolean;
    countInBars: number;
    preRollEnabled: boolean;
    preRollBars: number;
    masterGain: number;
};

export type ProjectArrangement = {
    tracks: ProjectTrack[];
};

export type ProjectTrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type ProjectClip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
    // Audio specific
    bufferId?: string;
    sampleStartBeat?: number;
    // MIDI specific
    notes?: ProjectMidiNote[];
    kneadState?: ProjectClipKneadState;
};

export type ProjectMidiCC = {
    beat: number;
    controller: number;
    value: number;
    channel: number;
};

export type ProjectMidiPitchBend = {
    beat: number;
    value: number;
    channel: number;
};

export type ProjectMidi = {
    notesByClipId: Record<string, ProjectMidiNote[]>;
    ccByClipId: Record<string, ProjectMidiCC[]>;
    pitchBendByClipId: Record<string, ProjectMidiPitchBend[]>;
};

export type ProjectMidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability: number;
    pressure: number;
    slide: number;
    pitchBend: number;
};

export type ProjectDevice = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
    externalPluginId?: string;
    externalInstanceId?: string;
};

export type ProjectSend = {
    busId: string;
    level: number;
    preFader: boolean;
};

export type ProjectMidiFxDevice = {
    id: string;
    name: string;
    type: 'arp' | 'velocity' | 'probability';
    bypassed: boolean;
    parameterValues: Record<string, number>;
};

export type ProjectFreezeState = {
    status: 'unfrozen' | 'freezing' | 'frozen' | 'stale' | 'error';
    freezeId?: string;
    frozenBufferId?: string;
    frozenAudioHash?: string;
    sourceContentHash?: string;
    deviceChainHash?: string;
    renderSettings?: {
        sampleRate: number;
        bitDepth: number;
        channelCount: number;
        tailLengthSeconds: number;
    };
    renderProgress?: number;
    errorMessage?: string;
    renderedAt?: number;
};

export type ProjectTrack = {
    id: string;
    name: string;
    kind: ProjectTrackKind;
    muted: boolean;
    soloed: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    color: string;
    clips: ProjectClip[];
    devices: ProjectDevice[];
    sends: ProjectSend[];
    midiFx: ProjectMidiFxDevice[];
    frozen: boolean;
    frozenBufferId?: string;
    freezeState: ProjectFreezeState;
    parentId: string | null;
    collapsed: boolean;
    inputMonitoring: 'auto' | 'on' | 'off';
    hidden: boolean;
    disabled: boolean;
    height: number;
    outputId: string;
    automationMode: 'read' | 'write' | 'latch' | 'touch' | 'off';
    groupId: string | null;
    soloSafe: boolean;
    notes: string;
    inputId: string | null;
    activeAlternativeId: string;
    alternatives: ProjectTrackAlternative[];
    vcaGroupId: string | null;
    midiOutputTrackId: string | null;
    followChordTrack: boolean;
};

export type ProjectTrackAlternative = {
    id: string;
    name: string;
    clips: ProjectClip[];
};

export type ProjectAutomation = {
    lanes: ProjectAutomationLane[];
};

export type ProjectAutomationLane = {
    id: string;
    trackId: string;
    parameterId: string;
    parameterName: string;
    points: ProjectAutomationPoint[];
    objects: ProjectAutomationObject[];
    visible: boolean;
    enabled: boolean;
    collapsed: boolean;
    virginTerritory: boolean;
    minValue: number;
    maxValue: number;
    color?: string;
};

export type ProjectAutomationObject = {
    id: string;
    laneId: string;
    startBeat: number;
    endBeat: number;
    points: ProjectAutomationPoint[];
    name: string;
};

export type ProjectAutomationPoint = {
    beat: number;
    value: number;
    curve: 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth' | 'bezier';
    tension: number;
};

export type ProjectMixer = {
    master: ProjectMasterStrip;
    buses: ProjectBusStrip[];
};

export type ProjectMasterStrip = {
    gain: number;
    pan: number;
};

export type ProjectBusStrip = {
    id: string;
    name: string;
    gain: number;
    pan: number;
    devices: ProjectDevice[];
};

export type ProjectMarker = {
    id: string;
    beat: number;
    name: string;
    color: string;
};

export type ProjectHistory = {
    checkpoints: ProjectCheckpoint[];
};

export type ProjectCheckpoint = {
    id: string;
    timestamp: number;
    label: string;
};

export type ProjectTempoMap = {
    changes: Array<{
        beat: number;
        tempo: number;
    }>;
};

export type ProjectTimeSignatureMap = {
    changes: Array<{
        beat: number;
        numerator: number;
        denominator: number;
    }>;
};

export type ProjectClipKneadBlob = {
    id: string;
    startTime: number;
    endTime: number;
    pitchCenterCents: number;
    pitchCurveCents: number[];
    voicedConfidence: number;
};

export type ProjectClipKneadState = {
    blobs: ProjectClipKneadBlob[];
    retuneSpeedMs: number;
    humanizePercent: number;
    formantPreserve: boolean;
};

export type ProjectExportedAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: string[];
};

export type ProjectTake = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
};

export type ProjectTakeLane = {
    id: string;
    trackId: string;
    automationLaneId?: string;
    takes: ProjectTake[];
    activeCompRegions: Array<{ startBeat: number; endBeat: number; takeId: string }>;
};

export type ProjectTakeLaneStoreState = {
    lanes: ProjectTakeLane[];
};

export type ProjectSidechainRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    targetParameterId: string;
    gain: number;
};

export type ProjectArrangementSnapshot = {
    id: string;
    name: string;
    tracks: unknown;
    automation: unknown;
    midi: unknown;
    tempoMap?: unknown;
    timeSignatureMap?: unknown;
    markers?: unknown;
    takeLanes?: unknown;
};

export const RECENT_PROJECTS_KEY = 'sourdaw-recent-projects';

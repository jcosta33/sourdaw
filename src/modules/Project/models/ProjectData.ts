import { type ArrangementSnapshot } from '../stores/arrangementStore';

export type ProjectTransportState = {
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

export type ProjectTempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

export type ProjectTempoMapState = {
    changes: ProjectTempoChange[];
};

export type ProjectTimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

export type ProjectTimeSignatureMapState = {
    changes: ProjectTimeSignatureChange[];
};

export type ProjectMarker = {
    id: string;
    beat: number;
    name: string;
    color: string;
};

export type ProjectArrangementSection = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
};

export type ProjectMarkerState = {
    markers: ProjectMarker[];
    sections: ProjectArrangementSection[];
};

export type ProjectSidechainRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    targetParameterId: string;
    gain: number;
};

export type ProjectTake = {
    id: string;
    clipId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    selected: boolean;
};

export type ProjectCompRegion = {
    startBeat: number;
    endBeat: number;
    takeId: string;
};

export type ProjectTakeLane = {
    id: string;
    trackId: string;
    takes: ProjectTake[];
    activeCompRegions: ProjectCompRegion[];
};

export type ProjectTakeLaneStoreState = {
    lanes: ProjectTakeLane[];
};

export type ProjectAutomationCurveType = 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth';

export type ProjectAutomationPoint = {
    beat: number;
    value: number;
    curve: ProjectAutomationCurveType;
    tension: number;
    stairSteps?: number;
};

export type ProjectAutomationObject = {
    id: string;
    laneId: string;
    startBeat: number;
    endBeat: number;
    points: ProjectAutomationPoint[];
    poolId?: string;
    loopLength?: number;
    name: string;
};

export type ProjectAutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    clipAutomationMode?: 'additive' | 'multiplicative';
    parameterId: string;
    parameterName: string;
    points: ProjectAutomationPoint[];
    trimPoints?: ProjectAutomationPoint[];
    objects: ProjectAutomationObject[];
    visible: boolean;
    enabled: boolean;
    collapsed: boolean;
    virginTerritory: boolean;
    minValue: number;
    maxValue: number;
    viewMinValue?: number;
    viewMaxValue?: number;
    color?: string;
};

export type ProjectAutomationState = {
    lanes: ProjectAutomationLane[];
};

export type ProjectMidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
};

export type ProjectMidiCC = {
    id: string;
    controller: number;
    value: number;
    beat: number;
    channel: number;
};

export type ProjectMidiPitchBend = {
    id: string;
    value: number;
    beat: number;
    channel: number;
};

export type ProjectMidiState = {
    notesByClipId: Record<string, ProjectMidiNote[]>;
    ccByClipId: Record<string, ProjectMidiCC[]>;
    pitchBendByClipId: Record<string, ProjectMidiPitchBend[]>;
};

export type ProjectExportedAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: string[];
};

export type ProjectTrackKind = 'audio' | 'midi' | 'bus' | 'master' | 'folder';

export type ProjectInputMonitoring = 'auto' | 'on' | 'off';

export type ProjectAutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off';

export type ProjectStretchMode = 'off' | 'repitch' | 'timestretch';

export type ProjectFollowAction = 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';

export type ProjectClip = {
    id: string;
    trackId: string;
    name: string;
    startBeat: number;
    endBeat: number;
    type: 'audio' | 'midi';
    audioBufferId?: string;
    assetHash?: string;
    audioOffsetBeats?: number;
    fadeInBeats: number;
    fadeOutBeats: number;
    gain: number;
    color: string;
    locked: boolean;
    muted: boolean;
    stretchMode?: ProjectStretchMode;
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    followAction?: ProjectFollowAction;
    generating?: boolean;
    isGhost?: boolean;
    parentClipId?: string;
    overrides?: Record<string, boolean>;
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

export type ProjectTrackAlternative = {
    id: string;
    name: string;
    clips: ProjectClip[];
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
    frozen: boolean;
    frozenBufferId?: string;
    parentId: string | null;
    collapsed: boolean;
    inputMonitoring: ProjectInputMonitoring;
    hidden: boolean;
    disabled: boolean;
    height: number;
    outputId: string;
    automationMode: ProjectAutomationMode;
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

export type ProjectTrackStoreState = {
    tracks: ProjectTrack[];
    selectedTrackId: string | null;
};

export type ProjectData = {
    version: 1;
    name: string;
    createdAt: number;
    updatedAt: number;
    tracks: ProjectTrackStoreState;
    transport: ProjectTransportState;
    automation: ProjectAutomationState;
    midi: ProjectMidiState;
    tempoMap?: ProjectTempoMapState;
    timeSignatureMap?: ProjectTimeSignatureMapState;
    markers?: ProjectMarkerState;
    takeLanes?: ProjectTakeLaneStoreState;
    sidechainRoutes?: ProjectSidechainRoute[];

    // New arrangement fields
    arrangements?: ArrangementSnapshot[];
    activeArrangementId?: string;

    /** Audio buffer data embedded for portability. Keyed by audioBufferId.
     * Present when the project was exported with "include audio" (the default).
     * Absent in legacy files — those rely on the local IDB cache instead. */
    audioBuffers?: Record<string, ProjectExportedAudioBuffer>;
};

export const RECENT_PROJECTS_KEY = 'sourdaw:recent-projects';

export type ProjectContext = {
    tempo: number;
    timeSignature: [number, number];
    isPlaying: boolean;
    isRecording: boolean;
    isLooping: boolean;
    loopStart: number;
    loopEnd: number;
    punchInEnabled: boolean;
    punchInBeat: number;
    punchOutBeat: number;
    metronomeEnabled: boolean;
    metronomeVolume: number;
    masterGain: number;
    availableDeviceTypes?: ProjectContextAvailableDeviceType[];
    automationLanes?: ProjectContextAutomationLane[];
    sidechainRoutes?: ProjectContextSidechainRoute[];
    vcaGroups?: ProjectContextVcaGroup[];
    tracks: ProjectContextTrack[];
    selectedTrackId: string | null;
    selectedClipId: string | null;
    selectedClipIds: string[];
    glueEligibleClipPairs?: Array<[string, string]>;
    activeView: 'arrange' | 'automation' | 'clip' | 'mix';
    playheadPosition: number;
};

export type ProjectContextAvailableDeviceType = {
    id: string;
    name: string;
};

export type ProjectContextAutomationPoint = {
    beat: number;
    value: number;
    curve: 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth' | 'bezier';
};

export type ProjectContextAutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    parameterId: string;
    name: string;
    enabled: boolean;
    minValue: number;
    maxValue: number;
    points: ProjectContextAutomationPoint[];
};

export type ProjectContextSidechainRoute = {
    id: string;
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
    targetParameterId: string;
    gain: number;
};

export type ProjectContextVcaGroup = {
    id: string;
    name: string;
    gain: number;
    muted: boolean;
    trackIds: string[];
};

export type ProjectContextClip = {
    id: string;
    name: string;
    type: 'audio' | 'midi';
    startBeat: number;
    endBeat: number;
    gain?: number;
    locked?: boolean;
    muted?: boolean;
    color?: string;
    fadeInBeats?: number;
    fadeOutBeats?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    minimumLoopLengthBeats?: number;
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
    /**
     * The settings the engine distinguishes, when they are not every integer in
     * the range — the descriptor's declared legal set.
     *
     * Carried into the context because the bridge validates against the
     * declaration rather than snapping: a model that asks for
     * `crust/oversampling: 9` has asked for a setting that does not exist, and
     * the honest answer is a rejection it can see and correct. Snapping it to 8
     * would hand back a confirmation for something the model did not request.
     */
    legalValues?: number[];
    unit: string;
    choices?: string[];
};

export type ProjectContextSend = {
    busId: string;
    level: number;
    preFader: boolean;
};

export type ProjectContextTrack = {
    id: string;
    name: string;
    kind: string;
    muted: boolean;
    soloed: boolean;
    soloSafe: boolean;
    armed: boolean;
    gain: number;
    pan: number;
    automationMode: 'read' | 'write' | 'touch' | 'latch' | 'off';
    vcaGroupId?: string | null;
    outputId?: string;
    clipCount: number;
    deviceCount: number;
    clips: ProjectContextClip[];
    devices: ProjectContextDevice[];
    sends?: ProjectContextSend[];
};

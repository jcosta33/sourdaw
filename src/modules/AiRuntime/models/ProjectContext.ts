import { CLIP_GAIN_LAW, SEND_LEVEL_LAW, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';

export type ProjectContext = {
    productionBrief?: ProjectContextProductionBrief;
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
    /**
     * {@link masterGain} in decibels; `null` at silence, which has no finite
     * reading. Optional like every other decibel figure here: it is a reading
     * of the linear value beside it rather than a second source of truth, so a
     * caller assembling a context by hand may leave it out and a reader can
     * always take it from {@link masterGain} instead.
     */
    masterGainDb?: number | null;
    /**
     * The decibel windows every level in this context lives inside, stated once
     * at the root rather than repeated beside each level. A reader that knows a
     * track sits at −1.9 dB still cannot ask for −3 dB without knowing how far
     * the control goes. The windows are constants — {@link
     * PROJECT_CONTEXT_LEVEL_LAW} — not project state, so a context without them
     * is missing nothing a reader cannot recover.
     */
    levelLaw?: ProjectContextLevelLaw;
    availableDeviceTypes?: ProjectContextAvailableDeviceType[];
    adjustmentLayers?: ProjectContextAdjustmentLayer[];
    automationLanes?: ProjectContextAutomationLane[];
    sidechainRoutes?: ProjectContextSidechainRoute[];
    sections?: ProjectContextSection[];
    vcaGroups?: ProjectContextVcaGroup[];
    tracks: ProjectContextTrack[];
    selectedTrackId: string | null;
    selectedClipId: string | null;
    selectedClipIds: string[];
    glueEligibleClipPairs?: Array<[string, string]>;
    activeView: 'arrange' | 'automation' | 'clip' | 'mix';
    playheadPosition: number;
};

export type ProjectContextLevelLaw = {
    /** Floor of a track, master, or clip level, in decibels. */
    floorDb: number;
    /** Unity gain. Always `0` — it is the reference every other figure here is read against. */
    unityDb: 0;
    /** Ceiling of a track or master fader, in decibels: the headroom above unity. */
    ceilingDb: number;
    /** Floor of a send level, in decibels. */
    sendFloorDb: number;
    /** A send taps a copy of the signal rather than amplifying it, so it stops at unity. */
    sendCeilingDb: 0;
    /** Ceiling of a clip's own gain trim, in decibels. */
    clipCeilingDb: number;
};

/**
 * The one set of decibel windows a project context ever reports. The controls'
 * laws do not vary with the project, so this is assembled from them once
 * rather than measured per context.
 */
export const PROJECT_CONTEXT_LEVEL_LAW: ProjectContextLevelLaw = {
    floorDb: TRACK_FADER_LAW.floorDb,
    unityDb: 0,
    ceilingDb: TRACK_FADER_LAW.ceilingDb,
    sendFloorDb: SEND_LEVEL_LAW.floorDb,
    sendCeilingDb: 0,
    clipCeilingDb: CLIP_GAIN_LAW.ceilingDb,
};

export type ProjectContextProductionBriefScope =
    | { kind: 'project' }
    | { kind: 'track'; trackId: string }
    | { kind: 'section'; sectionId: string }
    | { kind: 'object'; objectType: string; objectId: string }
    | { kind: 'range'; startBeat: number; endBeat: number }
    | { kind: 'decision'; decisionId: string };

export type ProjectContextProductionBrief = {
    schemaVersion: number;
    id: string;
    revision: number;
    vision: string | null;
    references: Array<{
        id: string;
        label: string;
        uri: string | null;
        assetHash: string | null;
        createdAt: number;
    }>;
    hardConstraints: Array<{
        id: string;
        scope: ProjectContextProductionBriefScope;
        statement: string;
        createdAt: number;
    }>;
    preferences: Array<{
        id: string;
        scope: ProjectContextProductionBriefScope;
        statement: string;
        createdAt: number;
    }>;
    sectionGoals: Array<{ id: string; sectionId: string; statement: string; createdAt: number }>;
    trackRoles: Array<{ id: string; trackId: string; role: string; createdAt: number }>;
    locks: Array<{
        id: string;
        scope: ProjectContextProductionBriefScope;
        statement: string;
        createdAt: number;
    }>;
    decisions: Array<{
        id: string;
        scope: ProjectContextProductionBriefScope;
        statement: string;
        rationale: string | null;
        status: 'accepted' | 'locked' | 'rejected' | 'superseded';
        sourceRunId: string | null;
        relatedBatchId: string | null;
        supersededByDecisionId: string | null;
        createdAt: number;
    }>;
    unresolvedQuestions: Array<{ id: string; statement: string; createdAt: number }>;
    sourceRunLinks: Array<{ id: string; sourceRunId: string; createdAt: number }>;
    supersedesBriefId: string | null;
    supersededByBriefId: string | null;
    createdAt: number;
    updatedAt: number;
};

export type ProjectContextAdjustmentRegion = {
    id: string;
    startBeat: number;
    endBeat: number;
    blend: number;
    fadeInBeats: number;
    fadeOutBeats: number;
};

export type ProjectContextAdjustmentLayer = {
    id: string;
    name: string;
    effectType: 'eq' | 'compressor' | 'reverb' | 'delay' | 'saturation' | 'filter' | 'stereo-width' | 'volume' | 'pan';
    parameters: Array<{
        name: string;
        value: number;
        min: number;
        max: number;
        unit: string;
    }>;
    affectedTrackIds: string[];
    insertionIndex: number;
    regions: ProjectContextAdjustmentRegion[];
    enabled: boolean;
    mix: number;
    color: string;
};

export type ProjectContextSection = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
};

export type ProjectContextAvailableDeviceType = {
    id: string;
    name: string;
    parameters?: ProjectContextDeviceParameter[];
};

export type ProjectContextAutomationPoint = {
    beat: number;
    value: number;
    curve: 'linear' | 'exponential' | 'step' | 's-curve' | 'stairs' | 'smooth' | 'bezier';
    tension?: number;
    stairSteps?: number;
    cp1?: { x: number; y: number };
    cp2?: { x: number; y: number };
};

export type ProjectContextAutomationLane = {
    id: string;
    trackId: string;
    clipId?: string;
    parameterId: string;
    name: string;
    enabled: boolean;
    linkedLaneId?: string;
    linkScale?: number;
    minValue: number;
    /** Stored project bound used to preserve segment-local legacy headroom semantics. */
    declaredMaxValue?: number;
    /** Effective ceiling retained for existing context consumers. */
    maxValue: number;
    /** {@link minValue} in decibels, on a gain lane only — every other lane measures
     *  something decibels do not describe. */
    minValueDb?: number;
    /** {@link maxValue} in decibels, on a gain lane only. */
    maxValueDb?: number;
    points: ProjectContextAutomationPoint[];
    /**
     * Set only on a lane an earlier member of the plan being grounded creates: later members may
     * write to it, but it is not a lane the project already holds, so the member creating it is
     * not a duplicate of it.
     */
    createdByPlan?: true;
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
    /** {@link gain} in decibels; `null` at silence, which has no finite reading. */
    gainDb?: number | null;
    locked?: boolean;
    muted?: boolean;
    color?: string;
    fadeInBeats?: number;
    fadeOutBeats?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    minimumLoopLengthBeats?: number;
    /**
     * Where the clip's content starts, in the clip's own media coordinates. Note beats are stored in
     * those coordinates, so this is what maps a note to the beat it actually sounds on: slipping a
     * clip moves the window without moving a single note.
     */
    midiOffsetBeats?: number;
    noteCount: number;
};

export type ProjectContextDevice = {
    id: string;
    name?: string;
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
    /** {@link level} in decibels; `null` at silence, which has no finite reading. */
    levelDb?: number | null;
    preFader: boolean;
};

export type ProjectContextTrack = {
    /** Structural copy of Project's derived evidence; the context producer calls its owner. */
    canonicalRole?: { role: string; source: string; evidence: string; contentRevision?: string };
    id: string;
    name: string;
    kind: string;
    muted: boolean;
    soloed: boolean;
    soloSafe: boolean;
    armed: boolean;
    frozen?: boolean;
    gain: number;
    /** {@link gain} in decibels; `null` at silence, which has no finite reading. */
    gainDb?: number | null;
    pan: number;
    automationMode: 'read' | 'write' | 'touch' | 'latch' | 'off';
    vcaGroupId?: string | null;
    outputId?: string;
    clipCount: number;
    alternativeClipIds?: string[];
    deviceCount: number;
    clips: ProjectContextClip[];
    devices: ProjectContextDevice[];
    sends?: ProjectContextSend[];
};

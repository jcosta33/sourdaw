/**
 * Canonical Project Data Schema
 *
 * This file defines the serializable JSON schema for .sourdaw files.
 * It mirrors the domain models (Track, Clip, Automation) but ensures
 * everything is a plain object with no class methods or engine refs.
 */

import { type ProductionBrief } from './ProductionBrief';

/**
 * The schema version written into every new `.sourdaw` file by the current
 * build. Bump this whenever the serialized shape changes in a way that older
 * builds cannot read, and add the corresponding migration so older files can
 * still be loaded.
 */
export const CURRENT_PROJECT_VERSION = 2;

/**
 * The oldest schema version this build is still able to load. Files at a
 * version below this (or above {@link CURRENT_PROJECT_VERSION}) are rejected by
 * the import validators rather than silently misread. Version 1 remains the
 * floor while the forward migration adds the canonical project identity.
 */
export const MIN_SUPPORTED_PROJECT_VERSION = 1;

const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 9562 UUID versions 1-8 in the interoperable 10xx variant. */
export function isCanonicalProjectId(value: unknown): value is string {
    return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

/** Mint a collision-resistant project address once, at project creation or migration. */
export function createProjectId(): string {
    return crypto.randomUUID();
}

function hashProjectIdentitySeed(value: string): readonly [number, number, number, number] {
    let first = 1_779_033_703;
    let second = 3_144_134_277;
    let third = 1_013_904_242;
    let fourth = 2_773_480_762;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        first = second ^ Math.imul(first ^ code, 597_399_067);
        second = third ^ Math.imul(second ^ code, 2_869_860_233);
        third = fourth ^ Math.imul(third ^ code, 951_274_213);
        fourth = first ^ Math.imul(fourth ^ code, 2_716_044_179);
    }
    first = Math.imul(third ^ (first >>> 18), 597_399_067);
    second = Math.imul(fourth ^ (second >>> 22), 2_869_860_233);
    third = Math.imul(first ^ (third >>> 17), 951_274_213);
    fourth = Math.imul(second ^ (fourth >>> 19), 2_716_044_179);
    return [
        (first ^ second ^ third ^ fourth) >>> 0,
        (second ^ first) >>> 0,
        (third ^ first) >>> 0,
        (fourth ^ first) >>> 0,
    ];
}

function hex32(value: number): string {
    return value.toString(16).padStart(8, '0');
}

/** UUIDv8-shaped deterministic address for legacy projects that predate a project UUID. */
export function deriveDeterministicProjectId(legacyProjectId: string, stableEntropy?: string): string {
    const [first, second, third, fourth] = hashProjectIdentitySeed(
        stableEntropy ? `${legacyProjectId}\u0000${stableEntropy}` : legacyProjectId
    );
    const hex = `${hex32(first)}${hex32(second)}${hex32(third)}${hex32(fourth)}`;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${(
        (Number.parseInt(hex.slice(16, 17), 16) & 3) |
        8
    ).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * True when `version` is one this build can load — i.e. within the inclusive
 * range [{@link MIN_SUPPORTED_PROJECT_VERSION}, {@link CURRENT_PROJECT_VERSION}].
 * The import validators gate on this instead of comparing against a bare literal
 * so the supported range lives in one place.
 */
export function isSupportedProjectVersion(version: unknown): version is number {
    return (
        typeof version === 'number' &&
        Number.isInteger(version) &&
        version >= MIN_SUPPORTED_PROJECT_VERSION &&
        version <= CURRENT_PROJECT_VERSION
    );
}

export type ProjectData = {
    version: number;
    meta: ProjectMeta;
    transport: ProjectTransport;
    arrangement: ProjectArrangement;
    automation: ProjectAutomation;
    midi: ProjectMidi;
    chordTrack?: ProjectChordTrackState;
    grooves?: ProjectGrooveState;
    /** Device-keyed racks on write; the legacy flat form is read-tolerated. */
    yeast?: ProjectYeastState | ProjectYeastFlatState;
    /**
     * DEAD FIELD — written, never read.
     *
     * `buildProjectData` writes the literal `{ master: { gain: 0.8, pan: 0 }, buses: [] }`
     * and so do `mapToProjectData`, `normalizeLegacyProjectData` and the demo
     * builders. No import, hydration or render path reads `data.mixer`: the real
     * master gain round-trips as {@link ProjectTransport.masterGain}, and buses are
     * ordinary `kind: 'bus'` rows in {@link ProjectArrangement.tracks}.
     *
     * Deleting it requires a project-format migration so older saved projects remain
     * loadable; no current runtime path depends on the value.
     */
    mixer: ProjectMixer;
    vcaGroups?: ProjectVcaGroup[];
    gainEnvelopes?: ProjectClipGainEnvelope[];
    modulation?: ProjectModulation;
    cvGate?: ProjectCvGate;
    markers: ProjectMarker[];
    tempoMap?: ProjectTempoMap;
    timeSignatureMap?: ProjectTimeSignatureMap;
    takeLanes?: ProjectTakeLaneStoreState;
    sidechainRoutes?: ProjectSidechainRoute[];
    arrangements?: ProjectArrangementSnapshot[];
    activeArrangementId?: string;
    audioBuffers?: Record<string, ProjectExportedAudioBuffer>;
    adjustmentLayers?: ProjectAdjustmentLayers;
    history: ProjectHistory;
};

export type ProjectAdjustmentEffectType =
    'eq' | 'compressor' | 'reverb' | 'delay' | 'saturation' | 'filter' | 'stereo-width' | 'volume' | 'pan';

export type ProjectAdjustmentParameter = {
    name: string;
    value: number;
    min: number;
    max: number;
    unit: string;
};

export type ProjectAdjustmentRegion = {
    id: string;
    startBeat: number;
    endBeat: number;
    blend: number;
    fadeInBeats: number;
    fadeOutBeats: number;
};

export type ProjectAdjustmentLayer = {
    id: string;
    name: string;
    effectType: ProjectAdjustmentEffectType;
    parameters: ProjectAdjustmentParameter[];
    affectedTrackIds: string[];
    insertionIndex: number;
    regions: ProjectAdjustmentRegion[];
    enabled: boolean;
    mix: number;
    color: string;
};

export type ProjectAdjustmentLayers = {
    layers: ProjectAdjustmentLayer[];
};

export type ProjectMeta = {
    /** Stable project address. Version-1 files omit it and mint one during the explicit forward migration. */
    projectId?: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    keyRoot: number;
    scaleName: string;
    tuning: {
        name: string;
        frequencies: number[];
    };
    productionBrief?: ProductionBrief;
};

export function deriveProjectIdFromMeta(meta: ProjectMeta): string {
    return deriveDeterministicProjectId(String(meta.createdAt));
}

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
    fileId?: string;
    // Runtime aliases retained only for loading snapshots written before the
    // arrangement collection gained an explicit serialized shape.
    audioBufferId?: string;
    audioOffsetBeats?: number;
    assetHash?: string;
    midiOffsetBeats?: number;
    stretchMode?: 'off' | 'repitch' | 'timestretch';
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    followAction?: 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';
    generating?: boolean;
    isGhost?: boolean;
    isInlineEditing?: boolean;
    parentClipId?: string;
    isLinkedInstance?: boolean;
    sourceKeyRoot?: number;
    sourceScaleName?: string;
    overrides?: Record<string, boolean>;
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
    probabilitySeed?: number;
    notesByClipId: Record<string, ProjectMidiNote[]>;
    ccByClipId: Record<string, ProjectMidiCC[]>;
    pitchBendByClipId: Record<string, ProjectMidiPitchBend[]>;
};

export type ProjectChordQuality =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';

export type ProjectChordEvent = {
    id: string;
    beat: number;
    root: number;
    quality: ProjectChordQuality;
    duration: number;
};

export type ProjectChordTrackState = {
    enabled: boolean;
    events: ProjectChordEvent[];
};

export type ProjectArrangementMidi = {
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
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    /** The range the recorded `pitchBend` was captured against. Absent means the
     *  reader falls back to the MPE default, so it must survive a save. */
    pitchBendRangeSemitones?: number;
    channel?: number;
    articulation?: string;
};

export type ProjectGrooveSubdivision = '1/8' | '1/16' | '1/32' | '1/16T';

export type ProjectGrooveTemplate = {
    id: string;
    name: string;
    schemaVersion: 1;
    subdivision: ProjectGrooveSubdivision;
    slots: Array<{ index: number; timingOffset: number; dynamicsOffset: number }>;
    provenance:
        | { type: 'builtin'; sourceId: string }
        | { type: 'user'; sourceId: string }
        | { type: 'midi-clip'; sourceId: string; analyzerVersion: number }
        | { type: 'legacy'; sourceId: string };
};

export type ProjectGrooveAssignment = {
    consumerType: 'clip' | 'yeast-processor' | 'toaster-pattern' | 'arpeggiator' | 'sequencer';
    consumerId: string;
    templateId: string;
    amount: number;
};

export type ProjectGrooveState = {
    templates: ProjectGrooveTemplate[];
    assignments: ProjectGrooveAssignment[];
};

export type ProjectYeastProcessorType =
    | 'arpeggiator'
    | 'chord'
    | 'chordMemory'
    | 'scale'
    | 'harmonizer'
    | 'repeater'
    | 'velocity'
    | 'humanizer'
    | 'filter'
    | 'transposer'
    | 'groove'
    | 'ccGenerator'
    | 'euclidean'
    | 'markov'
    | 'mutation';

export type ProjectYeastProcessor = {
    id: string;
    type: ProjectYeastProcessorType;
    name: string;
    bypassed: boolean;
    params?: Record<string, number>;
};

/** One Yeast device's rack, exactly as the pre-split file carried it. */
export type ProjectYeastRack = {
    processors: ProjectYeastProcessor[];
};

/**
 * Yeast racks in the project file, keyed by device instance id — one rack per
 * Yeast device (issue #2422), the same device-keyed shape the CRDT slot holds.
 * Files saved before the per-device split carry a single project-wide rack;
 * that legacy flat shape is still accepted on read and attaches to the first
 * Yeast device in project order.
 */
export type ProjectYeastState = {
    racks: Record<string, ProjectYeastRack>;
};

/**
 * The pre-split single-rack section (`{ processors }`), kept as the accepted
 * legacy input on read: hydrate attaches it to the first Yeast device in
 * project order — the same owner the CRDT slot's v1→v2 parking picks.
 */
export type ProjectYeastFlatState = {
    processors: ProjectYeastProcessor[];
};

/**
 * A VCA group master and its membership. Local mirror of Arrangement's
 * `VcaGroup`, duplicated rather than imported because models do not cross
 * module boundaries.
 *
 * `gain` is the linear multiplier the group applies on top of each member
 * track's own fader — `1` is unity, so a group omitted from the file comes back
 * as an unattenuated submix rather than the mix that was saved.
 */
export type ProjectVcaGroup = {
    id: string;
    name: string;
    gain: number;
    muted: boolean;
    trackIds: string[];
};

export type ProjectGainEnvelopePoint = {
    id: string;
    /** Beats from the owning clip's start. */
    beatOffset: number;
    gainDb: number;
};

/** Local mirror of Arrangement's `ClipGainEnvelope`, keyed by its own `clipId`. */
export type ProjectClipGainEnvelope = {
    clipId: string;
    points: ProjectGainEnvelopePoint[];
    enabled: boolean;
};

export type ProjectModulatorKind = 'lfo' | 'envelope' | 'step';

export type ProjectLfoModulatorConfig = {
    kind: 'lfo';
    waveform: 'sine' | 'square' | 'saw' | 'triangle' | 'random';
    /** Beats. */
    rate: number;
    sync: boolean;
    phase: number;
    depth: number;
};

export type ProjectEnvelopeModulatorConfig = {
    kind: 'envelope';
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    triggerMode: 'midi' | 'audio' | 'sync';
};

export type ProjectStepModulatorConfig = {
    kind: 'step';
    steps: number[];
    rate: number;
    smooth: number;
};

export type ProjectModulatorMapping = {
    targetTrackId: string;
    targetDeviceId: string;
    targetParamId: string;
    /** -1 to 1. */
    amount: number;
};

/** Local mirror of Automation's `Modulator`. */
export type ProjectModulator = {
    id: string;
    name: string;
    trackId: string;
    kind: ProjectModulatorKind;
    config: ProjectLfoModulatorConfig | ProjectEnvelopeModulatorConfig | ProjectStepModulatorConfig;
    mappings: ProjectModulatorMapping[];
    enabled: boolean;
};

export type ProjectModulation = {
    modulators: ProjectModulator[];
};

export type ProjectCvOutputChannel = {
    id: string;
    name: string;
    outputChannel: number;
    type: 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';
    minVoltage: number;
    maxVoltage: number;
    value: number;
    active: boolean;
};

/** Local mirror of CvGate's `CvGateState`. */
export type ProjectCvGate = {
    outputs: ProjectCvOutputChannel[];
    voltageStandard: '1v-per-octave' | 'hz-per-volt';
    clockDivision: number;
    triggerPulseMs: number;
    gateThreshold: number;
};

export type ProjectDevice = {
    id: string;
    name: string;
    type: string;
    bypassed: boolean;
    parameterValues: Record<string, number>;
    externalPluginId?: string;
    externalInstanceId?: string;
    /** Opaque native-plugin state chunk (base64) persisted in the `.sourdaw` snapshot
     *  so a native plugin reopens with its saved state (PH-3). */
    externalStateChunk?: string;
    /** Versioned device-owned state that `parameterValues` cannot express — pad
     *  names, enum strings, booleans, step sequences. Written and read by the owning
     *  module; this format carries it without interpreting it. */
    deviceState?: ProjectDeviceStateChunk;
};

/**
 * Local mirror of the Arrangement `DeviceStateValue` model. Duplicated rather than
 * imported because models do not cross module boundaries; structural typing keeps the
 * two assignable, which `buildProjectData` relies on.
 */
export type ProjectDeviceStateValue =
    string | number | boolean | null | ProjectDeviceStateValue[] | { [key: string]: ProjectDeviceStateValue };

export type ProjectDeviceStateChunk = {
    version: number;
    data: { [key: string]: ProjectDeviceStateValue };
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
        /**
         * Which set of freeze rules printed this buffer (`FREEZE_BAKE_VERSION`).
         * Absent means it predates the field. Declared here so a future
         * field-by-field load mapping cannot drop it with a green typecheck —
         * losing it makes a current freeze read as legacy and unfreeze itself.
         */
        bakeVersion?: number;
    };
    /**
     * Plugin-delay compensation the chain carried when the buffer was printed.
     * Frozen playback must shift by this baked figure, not the live chain's
     * current latency — a latency change never marks a frozen track stale, so
     * compensating against the current chain drifts silently and permanently.
     */
    compensationSeconds?: number;
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
    showVariationLanes?: boolean;
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
        id?: string;
        beat: number;
        tempo: number;
        curve?: 'instant' | 'linear';
    }>;
};

export type ProjectTimeSignatureMap = {
    changes: Array<{
        id?: string;
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
    originalPitchCenterCents?: number;
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
    freezeProjectId?: number;
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
    tracks?: {
        tracks: ProjectTrack[];
        selectedTrackId: string | null;
    };
    automation?: ProjectAutomation;
    midi?: ProjectArrangementMidi;
    tempoMap?: {
        changes: Array<{
            id: string;
            beat: number;
            tempo: number;
            curve: 'instant' | 'linear';
        }>;
    };
    timeSignatureMap?: {
        changes: Array<{
            id: string;
            beat: number;
            numerator: number;
            denominator: number;
        }>;
    };
    markers?: {
        markers: ProjectMarker[];
        sections: Array<{
            id: string;
            startBeat: number;
            endBeat: number;
            name: string;
            color: string;
        }>;
    };
    takeLanes?: ProjectTakeLaneStoreState;
};

export const RECENT_PROJECTS_KEY = 'sourdaw-recent-projects';

/**
 * Prefix of the per-project storage key, completed with the project's stable
 * `createdAt` id. Shared by the writer, the reader, and the localStorage
 * migration so a change here cannot orphan snapshots in one of them.
 */
export const NAMED_PROJECT_KEY_PREFIX = 'sourdaw:project:';

/** IndexedDB key of the active project document. */
export const ACTIVE_PROJECT_KEY = 'current';

/**
 * localStorage key that pre-ADR-0013 builds mirrored the active project
 * document to. Nothing writes it any more; the migration drains it.
 */
export const LEGACY_PROJECT_STORAGE_KEY = 'sourdaw-project';

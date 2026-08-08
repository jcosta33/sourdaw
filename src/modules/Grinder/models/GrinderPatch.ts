/**
 * Grinder — amp simulator, cabinet loader, pedalboard host, and neural-capture
 * playback engine. Full patch definition with types and parameter metadata.
 */

// ── Amp model types ──────────────────────────────────────────────────────────

export type GrinderAmpModel = 'clean-twin' | 'crunch-jcm' | 'lead-jcm' | 'ac30-tb' | 'rectifier' | 'custom';

export type GrinderToneStackType = 'fender' | 'marshall' | 'vox';

export type GrinderPowerTubeType = '6l6' | 'el34' | 'el84';

export type GrinderRectifierType = 'tube' | 'solid-state' | 'variac';

export type GrinderCabType = 'ir' | 'parametric' | 'both';

export type GrinderMicType = 'dynamic' | 'ribbon' | 'condenser' | 'room';

export type GrinderNeuralTier = 'standard' | 'lite' | 'nano' | 'recurrent';

export type GrinderEngineMode = 'circuit' | 'capture' | 'hybrid';

export type GrinderNeuralPlacement = 'amp-capture' | 'rig-capture';

export type GrinderNeuralStatus = 'idle' | 'warming' | 'ready';

export type GrinderUiSection = 'browse' | 'amp' | 'drive' | 'cab' | 'neural' | 'lab';

export type GrinderNeuralModelSource = 'builtin' | 'imported';

export type GrinderNeuralProfile = {
    derivedFrom: 'nam';
    sourceArchitecture: string;
    sourceSampleRate: number;
    sourceWeightCount: number;
    preferredTier: GrinderNeuralTier;
    inputDrive: number;
    asymmetry: number;
    outputTrim: number;
    contourMix: number;
    recurrentBias: number;
    convWeights: Array<[number, number, number]>;
};

export type GrinderNeuralLibraryEntry = {
    id: string;
    source: GrinderNeuralModelSource;
    name: string;
    family: string;
    placement: GrinderNeuralPlacement;
    description: string;
};

export type GrinderImportedNeuralModel = GrinderNeuralLibraryEntry & {
    source: 'imported';
    importedAt: number;
    sourceFileName: string | null;
    sourceFileText: string | null;
    profile: GrinderNeuralProfile;
};

export type GrinderCabLibraryEntry = {
    id: string;
    label: string;
    description: string;
};

export const GRINDER_CAB_LIBRARY: readonly GrinderCabLibraryEntry[] = [
    {
        id: '4x12-tight',
        label: '4x12 Tight',
        description: 'Closed-back stack with a tight low end and a focused upper mid push.',
    },
    {
        id: '2x12-open',
        label: '2x12 Open',
        description: 'Open-back cabinet with a wider midrange bloom and more air around the note.',
    },
    {
        id: '1x12-combo',
        label: '1x12 Combo',
        description: 'Compact combo voice with a balanced center and softer edge detail.',
    },
] as const;

export const GRINDER_NEURAL_LIBRARY: readonly GrinderNeuralLibraryEntry[] = [
    {
        id: 'factory-amp-a',
        source: 'builtin',
        name: 'Factory Amp A',
        family: 'NAM-compatible',
        placement: 'amp-capture',
        description: 'Focused head capture with a tight midrange and a smooth top.',
    },
    {
        id: 'factory-rig-b',
        source: 'builtin',
        name: 'Factory Rig B',
        family: 'A1-ready',
        placement: 'rig-capture',
        description: 'Full rig snapshot with denser low mids and a darker edge.',
    },
    {
        id: 'vintage-stack-c',
        source: 'builtin',
        name: 'Vintage Stack C',
        family: 'NAM-compatible',
        placement: 'amp-capture',
        description: 'Wider low mids with a softer attack and a more open upper band.',
    },
] as const;

// ── Pedal types ──────────────────────────────────────────────────────────────

export type GrinderPedalType =
    | 'noise-gate'
    | 'compressor'
    | 'boost'
    | 'overdrive'
    | 'distortion'
    | 'fuzz'
    | 'wah'
    | 'chorus'
    | 'flanger'
    | 'phaser'
    | 'tremolo'
    | 'eq';

export type GrinderPedal = {
    id: string;
    type: GrinderPedalType;
    enabled: boolean;
    params: Record<string, number>;
};

export const SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES = ['compressor', 'overdrive', 'distortion', 'fuzz'] as const;

export type GrinderSupportedChainPedalType = (typeof SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES)[number];

// ── Mic configuration ────────────────────────────────────────────────────────

export type GrinderMic = {
    type: GrinderMicType;
    positionX: number; // 0 = center, 1 = edge
    positionY: number; // 0 = on-axis, 1 = off-axis
    distance: number; // 0 = close, 1 = far
    gain: number; // dB
    enabled: boolean;
};

// ── Snapshot for scene switching ─────────────────────────────────────────────

export type GrinderSnapshot = {
    id: string;
    name: string;
    paramOverrides: Record<string, number>;
    bypassStates: Record<string, boolean>;
};

// ── Main patch ───────────────────────────────────────────────────────────────

export type GrinderPatch = {
    name: string;
    engineMode: GrinderEngineMode;
    uiSection: GrinderUiSection;

    // Input conditioning
    inputImpedance: number; // kΩ (10 – 10000)
    inputGain: number; // dB (-24 to +24)
    inputMode: 'instrument' | 'line' | 'reamp';

    // Noise gate
    gateEnabled: boolean;
    gateThreshold: number; // dB (-80 to 0)
    gateAttack: number; // ms
    gateRelease: number; // ms

    // Pedal chain (pre-amp)
    prePedals: GrinderPedal[];

    // Preamp
    ampModel: GrinderAmpModel;
    gain: number; // 0 – 10
    channel: number; // 0 = clean, 1 = crunch, 2 = lead
    bright: boolean;
    fat: boolean;

    // Tube parameters (Lab level)
    tubeBias: number; // 0 – 1
    tubeAge: number; // 0 – 1 (wear simulation)
    millerCapacitance: number; // 0 – 1
    gridConduction: number; // 0 – 1
    couplingCapCharge: number; // 0 – 1

    // Tone stack
    toneStackType: GrinderToneStackType;
    bass: number; // 0 – 10
    mid: number; // 0 – 10
    treble: number; // 0 – 10
    presence: number; // 0 – 10
    resonance: number; // 0 – 10
    brightCap: boolean;

    // Power amp
    master: number; // 0 – 10
    powerTubeType: GrinderPowerTubeType;
    rectifierType: GrinderRectifierType;
    sagAmount: number; // 0 – 1
    sagRecovery: number; // ms (10 – 2000)
    negFeedback: number; // 0 – 1
    powerAmpBias: number; // 0 – 1

    // Transformer
    transformerDrive: number; // 0 – 1
    transformerHysteresis: number; // 0 – 1
    transformerLfSaturation: number; // 0 – 1

    // Cabinet
    cabType: GrinderCabType;
    cabIrId: string; // loaded IR identifier
    cabEnabled: boolean;

    // Parametric speaker
    cabResonanceFreq: number; // Hz (40 – 200)
    cabResonanceQ: number; // 0.5 – 10
    cabDamping: number; // 0 – 1
    cabOpenBack: boolean;
    coneBreakup: number; // 0 – 1
    backEmf: number; // 0 – 1

    // Mic setup
    mic1: GrinderMic;
    mic2: GrinderMic;
    micBlend: number; // 0 = mic1 only, 1 = mic2 only
    roomAmount: number; // 0 – 1

    // Post effects
    postPedals: GrinderPedal[];

    // Neural capture
    neuralEnabled: boolean;
    neuralModelId: string;
    neuralModelName: string;
    neuralModelFamily: string;
    neuralModelSource: GrinderNeuralModelSource;
    neuralModelProfile: GrinderNeuralProfile | null;
    neuralStatus: GrinderNeuralStatus;
    neuralWarmupProgress: number; // 0 – 1
    neuralPlacement: GrinderNeuralPlacement;
    neuralTier: GrinderNeuralTier;
    neuralMix: number; // 0 – 1 (blend circuit model with neural)
    neuralCpuBudget: number; // 0 = eco, 1 = balanced, 2 = full

    // Output
    outputGain: number; // dB
    outputMix: number; // 0 – 1 (wet/dry)
    limiterEnabled: boolean;
    limiterThreshold: number; // dB

    // Routing
    routingMode: 'serial' | 'parallel' | 'wet-dry-wet' | 'dual-amp';
    cleanBlend: number; // 0 – 1 (dry DI blend)

    // Snapshots
    snapshots: GrinderSnapshot[];
    activeSnapshot: number;
};

// ── Default mic ──────────────────────────────────────────────────────────────

export const DEFAULT_MIC: GrinderMic = {
    type: 'dynamic',
    positionX: 0.3,
    positionY: 0.1,
    distance: 0.2,
    gain: 0,
    enabled: true,
};

// ── Default patch ────────────────────────────────────────────────────────────

export const DEFAULT_PATCH: GrinderPatch = {
    name: 'Init',
    engineMode: 'circuit',
    uiSection: 'browse',

    inputImpedance: 1000,
    inputGain: 0,
    inputMode: 'instrument',

    gateEnabled: false,
    gateThreshold: -60,
    gateAttack: 2,
    gateRelease: 120,

    prePedals: [],

    ampModel: 'crunch-jcm',
    gain: 5,
    channel: 1,
    bright: false,
    fat: false,

    tubeBias: 0.5,
    tubeAge: 0,
    millerCapacitance: 0.5,
    gridConduction: 0.5,
    couplingCapCharge: 0.5,

    toneStackType: 'marshall',
    bass: 5,
    mid: 5,
    treble: 5,
    presence: 5,
    resonance: 5,
    brightCap: false,

    master: 5,
    powerTubeType: 'el34',
    rectifierType: 'tube',
    sagAmount: 0.4,
    sagRecovery: 200,
    negFeedback: 0.5,
    powerAmpBias: 0.5,

    transformerDrive: 0.3,
    transformerHysteresis: 0.3,
    transformerLfSaturation: 0.3,

    cabType: 'both',
    cabIrId: '4x12-tight',
    cabEnabled: true,

    cabResonanceFreq: 80,
    cabResonanceQ: 2,
    cabDamping: 0.5,
    cabOpenBack: false,
    coneBreakup: 0.3,
    backEmf: 0.2,

    mic1: { ...DEFAULT_MIC },
    mic2: { ...DEFAULT_MIC, type: 'ribbon', positionX: 0.6, enabled: false },
    micBlend: 0,
    roomAmount: 0.1,

    postPedals: [],

    neuralEnabled: false,
    neuralModelId: '',
    neuralModelName: '',
    neuralModelFamily: 'NAM-compatible',
    neuralModelSource: 'builtin',
    neuralModelProfile: null,
    neuralStatus: 'idle',
    neuralWarmupProgress: 0,
    neuralPlacement: 'amp-capture',
    neuralTier: 'standard',
    neuralMix: 1,
    neuralCpuBudget: 1,

    outputGain: 0,
    outputMix: 1,
    limiterEnabled: true,
    limiterThreshold: -0.3,

    routingMode: 'serial',
    cleanBlend: 0,

    snapshots: [],
    activeSnapshot: 0,
};

function cloneMic(mic: Partial<GrinderMic> | undefined, defaults: GrinderMic): GrinderMic {
    return {
        ...defaults,
        ...(mic ?? {}),
    };
}

function clonePedal(pedal: Partial<GrinderPedal>, index: number): GrinderPedal {
    return {
        id: pedal.id ?? `pedal-${index}`,
        type: pedal.type ?? 'overdrive',
        enabled: pedal.enabled ?? false,
        params: { ...(pedal.params ?? {}) },
    };
}

function cloneSnapshot(snapshot: Partial<GrinderSnapshot>, index: number): GrinderSnapshot {
    return {
        id: snapshot.id ?? `snapshot-${index}`,
        name: snapshot.name ?? `Snapshot ${index + 1}`,
        paramOverrides: { ...(snapshot.paramOverrides ?? {}) },
        bypassStates: { ...(snapshot.bypassStates ?? {}) },
    };
}

function cloneNeuralProfile(profile: GrinderNeuralProfile | null | undefined): GrinderNeuralProfile | null {
    if (!profile) {
        return null;
    }

    return {
        ...profile,
        convWeights: profile.convWeights.map((weights) => [weights[0], weights[1], weights[2]]),
    };
}

export function isSupportedGrinderChainPedalType(pedal_type: string): pedal_type is GrinderSupportedChainPedalType {
    return (SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES as readonly string[]).includes(pedal_type);
}

export function getGrinderSupportedChainOrder(
    pedals: readonly GrinderPedal[],
    input?: { include_missing?: boolean }
): GrinderSupportedChainPedalType[] {
    const present = pedals
        .map((pedal) => pedal.type)
        .filter((pedal_type, index, items): pedal_type is GrinderSupportedChainPedalType => {
            return isSupportedGrinderChainPedalType(pedal_type) && items.indexOf(pedal_type) === index;
        });

    if (input?.include_missing === false) {
        return present;
    }

    return [...present, ...SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES.filter((pedal_type) => !present.includes(pedal_type))];
}

export function migrateGrinderPatch(patch: Partial<GrinderPatch> | GrinderPatch): GrinderPatch {
    const engineMode =
        patch.engineMode ??
        ((patch.neuralEnabled ?? DEFAULT_PATCH.neuralEnabled) ? 'hybrid' : DEFAULT_PATCH.engineMode);
    const neuralEnabled = patch.neuralEnabled ?? engineMode !== 'circuit';
    const neuralModelProfile = cloneNeuralProfile(patch.neuralModelProfile);
    const neuralModelSource =
        patch.neuralModelSource ?? (neuralModelProfile ? 'imported' : DEFAULT_PATCH.neuralModelSource);
    const cabIrId = patch.cabIrId && patch.cabIrId.length > 0 ? patch.cabIrId : DEFAULT_PATCH.cabIrId;

    return {
        ...DEFAULT_PATCH,
        ...patch,
        engineMode,
        uiSection: patch.uiSection ?? DEFAULT_PATCH.uiSection,
        prePedals: (patch.prePedals ?? DEFAULT_PATCH.prePedals).map((pedal, index) => clonePedal(pedal, index)),
        mic1: cloneMic(patch.mic1, DEFAULT_PATCH.mic1),
        mic2: cloneMic(patch.mic2, DEFAULT_PATCH.mic2),
        postPedals: (patch.postPedals ?? DEFAULT_PATCH.postPedals).map((pedal, index) => clonePedal(pedal, index)),
        snapshots: (patch.snapshots ?? DEFAULT_PATCH.snapshots).map((snapshot, index) =>
            cloneSnapshot(snapshot, index)
        ),
        neuralEnabled,
        cabIrId,
        neuralModelName: patch.neuralModelName ?? patch.neuralModelId ?? DEFAULT_PATCH.neuralModelName,
        neuralModelFamily: patch.neuralModelFamily ?? DEFAULT_PATCH.neuralModelFamily,
        neuralModelSource,
        neuralModelProfile,
        neuralStatus: patch.neuralStatus ?? DEFAULT_PATCH.neuralStatus,
        neuralWarmupProgress: patch.neuralWarmupProgress ?? DEFAULT_PATCH.neuralWarmupProgress,
        neuralPlacement: patch.neuralPlacement ?? DEFAULT_PATCH.neuralPlacement,
    };
}

// ── Parameter definitions ────────────────────────────────────────────────────

export type GrinderParamDef = {
    id: string;
    label: string;
    min: number;
    max: number;
    default: number;
    unit: string;
    step?: number;
    group?: string;
    scaling?: 'log' | 'linear';
};

export const GRINDER_PARAMS: readonly GrinderParamDef[] = [
    // Input
    { id: 'inputGain', label: 'Input', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'input' },
    {
        id: 'inputImpedance',
        label: 'Impedance',
        min: 10,
        max: 10000,
        default: 1000,
        unit: 'kΩ',
        step: 10,
        group: 'input',
    },

    // Gate
    { id: 'gateThreshold', label: 'Gate', min: -80, max: 0, default: -60, unit: 'dB', step: 1, group: 'gate' },
    // Kept equal to `DEFAULT_PATCH` above. This table is the one the Arrangement
    // descriptor was copied out of in `27d7ce794`, and the copy inherited the
    // 0.5 / 50 these two rows still held after `7690f7139` moved the patch to
    // 2 / 120 — which is how the Inspector and the automation lane came to
    // advertise a default no fresh Grinder has used since April.
    { id: 'gateAttack', label: 'Gate Atk', min: 0.1, max: 50, default: 2, unit: 'ms', group: 'gate', scaling: 'log' },
    { id: 'gateRelease', label: 'Gate Rel', min: 5, max: 500, default: 120, unit: 'ms', group: 'gate', scaling: 'log' },

    // Preamp
    { id: 'gain', label: 'Gain', min: 0, max: 10, default: 5, unit: '', step: 0.1, group: 'preamp' },
    { id: 'channel', label: 'Channel', min: 0, max: 2, default: 1, unit: '', step: 1, group: 'preamp' },
    { id: 'bright', label: 'Bright', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'preamp' },
    { id: 'fat', label: 'Fat', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'preamp' },

    // Tone stack
    { id: 'bass', label: 'Bass', min: 0, max: 10, default: 5, unit: '', step: 0.1, group: 'tone' },
    { id: 'mid', label: 'Mid', min: 0, max: 10, default: 5, unit: '', step: 0.1, group: 'tone' },
    { id: 'treble', label: 'Treble', min: 0, max: 10, default: 5, unit: '', step: 0.1, group: 'tone' },
    { id: 'presence', label: 'Presence', min: 0, max: 10, default: 5, unit: '', step: 0.1, group: 'tone' },
    { id: 'resonance', label: 'Resonance', min: 0, max: 10, default: 5, unit: '', step: 0.1, group: 'tone' },

    // Power amp
    { id: 'master', label: 'Master', min: 0, max: 10, default: 5, unit: '', step: 0.1, group: 'power' },
    { id: 'sagAmount', label: 'Sag', min: 0, max: 1, default: 0.4, unit: '', step: 0.01, group: 'power' },
    {
        id: 'sagRecovery',
        label: 'Sag Recovery',
        min: 10,
        max: 2000,
        default: 200,
        unit: 'ms',
        group: 'power',
        scaling: 'log',
    },
    { id: 'negFeedback', label: 'NFB', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'power' },

    // Transformer
    {
        id: 'transformerDrive',
        label: 'Xfmr Drive',
        min: 0,
        max: 1,
        default: 0.3,
        unit: '',
        step: 0.01,
        group: 'transformer',
    },
    {
        id: 'transformerHysteresis',
        label: 'Hysteresis',
        min: 0,
        max: 1,
        default: 0.3,
        unit: '',
        step: 0.01,
        group: 'transformer',
    },
    {
        id: 'transformerLfSaturation',
        label: 'LF Sat',
        min: 0,
        max: 1,
        default: 0.3,
        unit: '',
        step: 0.01,
        group: 'transformer',
    },

    // Cabinet
    {
        id: 'cabResonanceFreq',
        label: 'Cab Res',
        min: 40,
        max: 200,
        default: 80,
        unit: 'Hz',
        step: 1,
        group: 'cabinet',
        scaling: 'log',
    },
    { id: 'cabResonanceQ', label: 'Cab Q', min: 0.5, max: 10, default: 2, unit: '', step: 0.1, group: 'cabinet' },
    { id: 'cabDamping', label: 'Damping', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'cabinet' },
    { id: 'coneBreakup', label: 'Breakup', min: 0, max: 1, default: 0.3, unit: '', step: 0.01, group: 'cabinet' },
    { id: 'backEmf', label: 'Back EMF', min: 0, max: 1, default: 0.2, unit: '', step: 0.01, group: 'cabinet' },
    { id: 'micBlend', label: 'Mic Blend', min: 0, max: 1, default: 0, unit: '', step: 0.01, group: 'cabinet' },
    { id: 'roomAmount', label: 'Room', min: 0, max: 1, default: 0.1, unit: '', step: 0.01, group: 'cabinet' },

    // Lab
    { id: 'tubeBias', label: 'Tube Bias', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'lab' },
    { id: 'tubeAge', label: 'Tube Age', min: 0, max: 1, default: 0, unit: '', step: 0.01, group: 'lab' },
    { id: 'millerCapacitance', label: 'Miller Cap', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'lab' },
    { id: 'gridConduction', label: 'Grid Cond', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'lab' },
    {
        id: 'couplingCapCharge',
        label: 'Coupling Cap',
        min: 0,
        max: 1,
        default: 0.5,
        unit: '',
        step: 0.01,
        group: 'lab',
    },
    { id: 'powerAmpBias', label: 'PA Bias', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'lab' },

    // Neural
    { id: 'engineMode', label: 'Engine Mode', min: 0, max: 2, default: 0, unit: '', step: 1, group: 'neural' },
    { id: 'neuralMix', label: 'Neural Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'neural' },
    { id: 'neuralCpuBudget', label: 'CPU Budget', min: 0, max: 2, default: 1, unit: '', step: 1, group: 'neural' },

    // Output
    { id: 'outputGain', label: 'Output', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'output' },
    { id: 'outputMix', label: 'Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'output' },
    { id: 'cleanBlend', label: 'Clean Blend', min: 0, max: 1, default: 0, unit: '', step: 0.01, group: 'output' },
    {
        id: 'limiterThreshold',
        label: 'Limiter',
        min: -12,
        max: 0,
        default: -0.3,
        unit: 'dB',
        step: 0.1,
        group: 'output',
    },
];

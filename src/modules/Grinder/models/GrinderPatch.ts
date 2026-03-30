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
    | 'delay'
    | 'reverb'
    | 'eq';

export type GrinderPedal = {
    id: string;
    type: GrinderPedalType;
    enabled: boolean;
    params: Record<string, number>;
};

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

    // FX Loop pedals
    fxLoopPedals: GrinderPedal[];
    fxLoopEnabled: boolean;
    fxLoopMix: number; // 0 – 1

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

    inputImpedance: 1000,
    inputGain: 0,
    inputMode: 'instrument',

    gateEnabled: true,
    gateThreshold: -60,
    gateAttack: 0.5,
    gateRelease: 50,

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

    fxLoopPedals: [],
    fxLoopEnabled: false,
    fxLoopMix: 1,

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
    cabIrId: '',
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
};

export const GRINDER_PARAMS: readonly GrinderParamDef[] = [
    // Input
    { id: 'inputGain', label: 'Input', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'input' },
    { id: 'inputImpedance', label: 'Impedance', min: 10, max: 10000, default: 1000, unit: 'kΩ', step: 10, group: 'input' },

    // Gate
    { id: 'gateThreshold', label: 'Gate', min: -80, max: 0, default: -60, unit: 'dB', step: 1, group: 'gate' },
    { id: 'gateAttack', label: 'Gate Atk', min: 0.1, max: 50, default: 0.5, unit: 'ms', group: 'gate' },
    { id: 'gateRelease', label: 'Gate Rel', min: 5, max: 500, default: 50, unit: 'ms', group: 'gate' },

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
    { id: 'sagRecovery', label: 'Sag Recovery', min: 10, max: 2000, default: 200, unit: 'ms', group: 'power' },
    { id: 'negFeedback', label: 'NFB', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'power' },

    // Transformer
    { id: 'transformerDrive', label: 'Xfmr Drive', min: 0, max: 1, default: 0.3, unit: '', step: 0.01, group: 'transformer' },
    { id: 'transformerHysteresis', label: 'Hysteresis', min: 0, max: 1, default: 0.3, unit: '', step: 0.01, group: 'transformer' },
    { id: 'transformerLfSaturation', label: 'LF Sat', min: 0, max: 1, default: 0.3, unit: '', step: 0.01, group: 'transformer' },

    // Cabinet
    { id: 'cabResonanceFreq', label: 'Cab Res', min: 40, max: 200, default: 80, unit: 'Hz', step: 1, group: 'cabinet' },
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
    { id: 'couplingCapCharge', label: 'Coupling Cap', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'lab' },
    { id: 'powerAmpBias', label: 'PA Bias', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'lab' },

    // Neural
    { id: 'neuralMix', label: 'Neural Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'neural' },
    { id: 'neuralCpuBudget', label: 'CPU Budget', min: 0, max: 2, default: 1, unit: '', step: 1, group: 'neural' },

    // Output
    { id: 'outputGain', label: 'Output', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'output' },
    { id: 'outputMix', label: 'Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'output' },
    { id: 'cleanBlend', label: 'Clean Blend', min: 0, max: 1, default: 0, unit: '', step: 0.01, group: 'output' },
    { id: 'limiterThreshold', label: 'Limiter', min: -12, max: 0, default: -0.3, unit: 'dB', step: 0.1, group: 'output' },
];

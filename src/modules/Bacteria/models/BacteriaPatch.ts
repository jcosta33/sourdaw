/**
 * Bacteria — creative multi-effects framework patch definition.
 *
 * All parameter definitions, types, and defaults for the multi-band
 * modular processor with distortion, filtering, granular, spectral,
 * modulation, and routing capabilities.
 */

// ── Effect module types ──────────────────────────────────────────────────────

export type BacteriaDistortionMode =
    | 'soft-clip'
    | 'hard-clip'
    | 'foldback'
    | 'wavefold'
    | 'bitcrush'
    | 'tube'
    | 'breakdown'
    | 'smudge'
    | 'custom';

export type BacteriaFilterMode = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'formant' | 'comb';

export type BacteriaCrossoverMode = 'lr4' | 'linear-phase';

export type BacteriaRoutingMode = 'serial' | 'parallel' | 'mid-side';

export type BacteriaModSourceType = 'lfo' | 'envelope-follower' | 'step-seq' | 'lorenz' | 'macro';

export type BacteriaGrainWindow = 'hann' | 'gaussian';

// ── Band configuration ───────────────────────────────────────────────────────

export type BacteriaBand = {
    enabled: boolean;
    solo: boolean;
    mute: boolean;
    gain: number; // dB (-24 to +24)
    oversampling: number; // 1, 2, 4, 8

    // Per-band effect chain enables
    distortionEnabled: boolean;
    filterEnabled: boolean;
    granularEnabled: boolean;
    spectralEnabled: boolean;
    modulationEnabled: boolean;
    convolutionEnabled: boolean;
    freqShiftEnabled: boolean;
    chorusEnabled: boolean;
    lofiEnabled: boolean;

    // Distortion
    distortionMode: BacteriaDistortionMode;
    drive: number; // 0 – 100
    asymmetry: number; // -1 to 1
    foldbackThreshold: number; // 0.1 – 1.0
    bitDepth: number; // 1 – 24
    sampleRateReduce: number; // 1 – 64 (divider)
    tubeBias: number; // 0 – 1
    breakdownDepth: number; // 0 – 4 (octaves)

    // Filter
    filterMode: BacteriaFilterMode;
    filterCutoff: number; // Hz (20 – 20000)
    filterResonance: number; // 0 – 1
    filterEnvAmount: number; // -1 to 1
    filterEnvAttack: number; // ms (0.1 – 500)
    filterEnvRelease: number; // ms (1 – 5000)

    // Modulation effects
    chorusRate: number; // Hz (0.01 – 20)
    chorusDepth: number; // 0 – 1
    chorusFeedback: number; // -1 to 1
    chorusMix: number; // 0 – 1

    // Phaser
    phaserEnabled: boolean;
    phaserRate: number; // Hz (0.01 – 10)
    phaserDepth: number; // 0 – 1
    phaserFeedback: number; // -1 to 1
    phaserMix: number; // 0 – 1

    // Granular
    grainSize: number; // ms (10 – 500)
    grainDensity: number; // grains/sec (1 – 100)
    grainPosOffset: number; // ms (0 – 2000)
    grainPitch: number; // semitones (-24 to +24)
    grainWindow: BacteriaGrainWindow;
    grainFreeze: boolean;
    grainMix: number; // 0 – 1

    // Spectral
    spectralBlur: number; // 0 – 1 (alpha)
    spectralFreeze: boolean;
    spectralMix: number; // 0 – 1

    // Frequency shifter
    freqShiftHz: number; // Hz (-1000 to 1000)
    freqShiftMix: number; // 0 – 1

    // Lo-fi / codec
    lofiAmount: number; // 0 – 100
    codecArtifact: number; // 0 – 1

    // Convolution body
    convolutionIr: string; // IR identifier
    convolutionMix: number; // 0 – 1
    convolutionSeparation: number; // 0 – 1 (mono → stereo widening)

    // Per-band routing
    routingMode: BacteriaRoutingMode;
};

// ── Modulation assignment ────────────────────────────────────────────────────

export type BacteriaModAssignment = {
    sourceId: string;
    targetParam: string;
    amount: number; // -1 to 1
    bipolar: boolean;
};

// ── Snapshot for XY morphing ─────────────────────────────────────────────────

export type BacteriaSnapshot = {
    id: 'A' | 'B' | 'C' | 'D';
    name: string;
    paramValues: Record<string, number>;
};

// ── Main patch ───────────────────────────────────────────────────────────────

export type BacteriaPatch = {
    name: string;

    // Global
    mix: number; // 0 – 1 (master wet/dry)
    outputGain: number; // dB (-24 to +24)
    inputGain: number; // dB (-24 to +24)
    bypass: boolean;

    // Crossover
    crossoverMode: BacteriaCrossoverMode;
    bandCount: number; // 1 – 6
    crossoverFreq1: number; // Hz
    crossoverFreq2: number; // Hz
    crossoverFreq3: number; // Hz
    crossoverFreq4: number; // Hz
    crossoverFreq5: number; // Hz
    crossoverSlope: number; // 0=12, 1=24, 2=36, 3=48 dB/oct

    // Bands (up to 6)
    bands: BacteriaBand[];

    // Global routing
    globalRouting: BacteriaRoutingMode;

    // Macros (8 performance macros)
    macro1: number; // 0 – 1
    macro2: number;
    macro3: number;
    macro4: number;
    macro5: number;
    macro6: number;
    macro7: number;
    macro8: number;

    // XY morph pad
    morphX: number; // 0 – 1
    morphY: number; // 0 – 1

    // Modulation assignments (stored as array)
    modAssignments: BacteriaModAssignment[];

    // Snapshots for XY morphing
    snapshots: BacteriaSnapshot[];

    // Global modulation sources
    lfo1Rate: number; // Hz (0.01 – 40)
    lfo1Shape: number; // 0=sine, 1=tri, 2=saw, 3=square, 4=s&h
    lfo1Sync: boolean;
    lfo1Amount: number; // 0 – 1
    lfo2Rate: number;
    lfo2Shape: number;
    lfo2Sync: boolean;
    lfo2Amount: number;

    envFollowerAttack: number; // ms (0.1 – 100)
    envFollowerRelease: number; // ms (1 – 2000)

    stepSeqSteps: number; // 1 – 32
    stepSeqRate: number; // Hz or tempo-synced divisions

    lorenzSigma: number; // Lorenz σ (default 10)
    lorenzRho: number; // Lorenz ρ (default 28)
    lorenzBeta: number; // Lorenz β (default 8/3)
    lorenzSpeed: number; // integration rate multiplier
};

// ── Default band ─────────────────────────────────────────────────────────────

export const DEFAULT_BAND: BacteriaBand = {
    enabled: true,
    solo: false,
    mute: false,
    gain: 0,
    oversampling: 2,

    distortionEnabled: false,
    filterEnabled: false,
    granularEnabled: false,
    spectralEnabled: false,
    modulationEnabled: false,
    convolutionEnabled: false,
    freqShiftEnabled: false,
    chorusEnabled: false,
    lofiEnabled: false,

    distortionMode: 'soft-clip',
    drive: 25,
    asymmetry: 0,
    foldbackThreshold: 0.7,
    bitDepth: 16,
    sampleRateReduce: 1,
    tubeBias: 0.5,
    breakdownDepth: 1,

    filterMode: 'lowpass',
    filterCutoff: 8000,
    filterResonance: 0.3,
    filterEnvAmount: 0,
    filterEnvAttack: 5,
    filterEnvRelease: 200,

    chorusRate: 1.5,
    chorusDepth: 0.4,
    chorusFeedback: 0.2,
    chorusMix: 0.5,

    phaserEnabled: false,
    phaserRate: 0.5,
    phaserDepth: 0.7,
    phaserFeedback: 0.5,
    phaserMix: 0.5,

    grainSize: 80,
    grainDensity: 15,
    grainPosOffset: 100,
    grainPitch: 0,
    grainWindow: 'hann',
    grainFreeze: false,
    grainMix: 0.5,

    spectralBlur: 0.5,
    spectralFreeze: false,
    spectralMix: 0.5,

    freqShiftHz: 0,
    freqShiftMix: 0.5,

    lofiAmount: 0,
    codecArtifact: 0,

    convolutionIr: '',
    convolutionMix: 0.3,
    convolutionSeparation: 0.5,

    routingMode: 'serial',
};

// ── Default patch ────────────────────────────────────────────────────────────

export const DEFAULT_PATCH: BacteriaPatch = {
    name: 'Init',

    mix: 1,
    outputGain: 0,
    inputGain: 0,
    bypass: false,

    crossoverMode: 'lr4',
    bandCount: 1,
    crossoverFreq1: 200,
    crossoverFreq2: 800,
    crossoverFreq3: 2500,
    crossoverFreq4: 6000,
    crossoverFreq5: 12000,
    crossoverSlope: 1,

    bands: [
        { ...DEFAULT_BAND },
        { ...DEFAULT_BAND },
        { ...DEFAULT_BAND },
        { ...DEFAULT_BAND },
        { ...DEFAULT_BAND },
        { ...DEFAULT_BAND },
    ],

    globalRouting: 'serial',

    macro1: 0.5,
    macro2: 0.5,
    macro3: 0.5,
    macro4: 0.5,
    macro5: 0.5,
    macro6: 0.5,
    macro7: 0.5,
    macro8: 0.5,

    morphX: 0.5,
    morphY: 0.5,

    modAssignments: [],
    snapshots: [
        { id: 'A', name: 'A', paramValues: {} },
        { id: 'B', name: 'B', paramValues: {} },
        { id: 'C', name: 'C', paramValues: {} },
        { id: 'D', name: 'D', paramValues: {} },
    ],

    lfo1Rate: 2,
    lfo1Shape: 0,
    lfo1Sync: false,
    lfo1Amount: 0.5,
    lfo2Rate: 0.5,
    lfo2Shape: 1,
    lfo2Sync: false,
    lfo2Amount: 0.5,

    envFollowerAttack: 5,
    envFollowerRelease: 200,

    stepSeqSteps: 16,
    stepSeqRate: 4,

    lorenzSigma: 10,
    lorenzRho: 28,
    lorenzBeta: 2.667,
    lorenzSpeed: 1,
};

// ── Parameter definitions (for descriptor and automation) ────────────────────

export type BacteriaParamDef = {
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

export const BACTERIA_PARAMS: readonly BacteriaParamDef[] = [
    // Global
    { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'global' },
    { id: 'inputGain', label: 'Input', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'global' },
    { id: 'outputGain', label: 'Output', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'global' },

    // Crossover
    { id: 'bandCount', label: 'Bands', min: 1, max: 6, default: 1, unit: '', step: 1, group: 'crossover' },
    {
        id: 'crossoverFreq1',
        label: 'XOver 1',
        min: 20,
        max: 20000,
        default: 200,
        unit: 'Hz',
        step: 1,
        group: 'crossover',
        scaling: 'log',
    },
    {
        id: 'crossoverFreq2',
        label: 'XOver 2',
        min: 20,
        max: 20000,
        default: 800,
        unit: 'Hz',
        step: 1,
        group: 'crossover',
        scaling: 'log',
    },
    {
        id: 'crossoverFreq3',
        label: 'XOver 3',
        min: 20,
        max: 20000,
        default: 2500,
        unit: 'Hz',
        step: 1,
        group: 'crossover',
        scaling: 'log',
    },
    {
        id: 'crossoverFreq4',
        label: 'XOver 4',
        min: 20,
        max: 20000,
        default: 6000,
        unit: 'Hz',
        step: 1,
        group: 'crossover',
        scaling: 'log',
    },
    {
        id: 'crossoverFreq5',
        label: 'XOver 5',
        min: 20,
        max: 20000,
        default: 12000,
        unit: 'Hz',
        step: 1,
        group: 'crossover',
        scaling: 'log',
    },
    { id: 'crossoverSlope', label: 'Slope', min: 0, max: 3, default: 1, unit: '', step: 1, group: 'crossover' },
    { id: 'crossoverMode', label: 'XOver Mode', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'crossover' },

    // Per-band distortion (band 0 — UI maps active band)
    { id: 'distortionMode', label: 'Dist Mode', min: 0, max: 8, default: 0, unit: '', step: 1, group: 'distortion' },
    { id: 'drive', label: 'Drive', min: 0, max: 100, default: 25, unit: '%', step: 1, group: 'distortion' },
    { id: 'asymmetry', label: 'Asymmetry', min: -1, max: 1, default: 0, unit: '', step: 0.01, group: 'distortion' },
    {
        id: 'foldbackThreshold',
        label: 'Fold Thresh',
        min: 0.1,
        max: 1,
        default: 0.7,
        unit: '',
        step: 0.01,
        group: 'distortion',
    },
    { id: 'bitDepth', label: 'Bit Depth', min: 1, max: 24, default: 16, unit: 'bit', step: 1, group: 'distortion' },
    {
        id: 'sampleRateReduce',
        label: 'SR Reduce',
        min: 1,
        max: 64,
        default: 1,
        unit: 'x',
        step: 1,
        group: 'distortion',
    },
    {
        id: 'breakdownDepth',
        label: 'Breakdown',
        min: 0,
        max: 4,
        default: 1,
        unit: 'oct',
        step: 0.1,
        group: 'distortion',
    },

    // Per-band filter
    { id: 'filterMode', label: 'Filter Mode', min: 0, max: 5, default: 0, unit: '', step: 1, group: 'filter' },
    {
        id: 'filterCutoff',
        label: 'Cutoff',
        min: 20,
        max: 20000,
        default: 8000,
        unit: 'Hz',
        step: 1,
        group: 'filter',
        scaling: 'log',
    },
    { id: 'filterResonance', label: 'Resonance', min: 0, max: 1, default: 0.3, unit: '', step: 0.01, group: 'filter' },
    { id: 'filterEnvAmount', label: 'Env Amount', min: -1, max: 1, default: 0, unit: '', step: 0.01, group: 'filter' },

    // Modulation effects
    {
        id: 'chorusRate',
        label: 'Chorus Rate',
        min: 0.01,
        max: 20,
        default: 1.5,
        unit: 'Hz',
        group: 'modulation',
        scaling: 'log',
    },
    {
        id: 'chorusDepth',
        label: 'Chorus Depth',
        min: 0,
        max: 1,
        default: 0.4,
        unit: '',
        step: 0.01,
        group: 'modulation',
    },
    {
        id: 'chorusFeedback',
        label: 'Chorus FB',
        min: -1,
        max: 1,
        default: 0.2,
        unit: '',
        step: 0.01,
        group: 'modulation',
    },
    { id: 'chorusMix', label: 'Chorus Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'modulation' },

    // Phaser
    {
        id: 'phaserRate',
        label: 'Phaser Rate',
        min: 0.01,
        max: 10,
        default: 0.5,
        unit: 'Hz',
        group: 'modulation',
        scaling: 'log',
    },
    {
        id: 'phaserDepth',
        label: 'Phaser Depth',
        min: 0,
        max: 1,
        default: 0.7,
        unit: '',
        step: 0.01,
        group: 'modulation',
    },
    {
        id: 'phaserFeedback',
        label: 'Phaser FB',
        min: -1,
        max: 1,
        default: 0.5,
        unit: '',
        step: 0.01,
        group: 'modulation',
    },
    { id: 'phaserMix', label: 'Phaser Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'modulation' },

    // Granular
    {
        id: 'grainSize',
        label: 'Grain Size',
        min: 10,
        max: 500,
        default: 80,
        unit: 'ms',
        step: 1,
        group: 'granular',
        scaling: 'log',
    },
    { id: 'grainDensity', label: 'Density', min: 1, max: 100, default: 15, unit: 'g/s', step: 1, group: 'granular' },
    {
        id: 'grainPosOffset',
        label: 'Position',
        min: 0,
        max: 2000,
        default: 100,
        unit: 'ms',
        step: 1,
        group: 'granular',
    },
    { id: 'grainPitch', label: 'Grain Pitch', min: -24, max: 24, default: 0, unit: 'st', step: 0.1, group: 'granular' },
    { id: 'grainMix', label: 'Grain Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'granular' },

    // Spectral
    { id: 'spectralBlur', label: 'Spec Blur', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'spectral' },
    { id: 'spectralMix', label: 'Spec Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'spectral' },

    // Frequency shifter
    {
        id: 'freqShiftHz',
        label: 'Freq Shift',
        min: -1000,
        max: 1000,
        default: 0,
        unit: 'Hz',
        step: 0.1,
        group: 'spectral',
    },
    { id: 'freqShiftMix', label: 'Shift Mix', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'spectral' },

    // Lo-fi
    { id: 'lofiAmount', label: 'Lo-Fi', min: 0, max: 100, default: 0, unit: '%', step: 1, group: 'lofi' },
    { id: 'codecArtifact', label: 'Codec', min: 0, max: 1, default: 0, unit: '', step: 0.01, group: 'lofi' },

    // Convolution
    {
        id: 'convolutionMix',
        label: 'Body Mix',
        min: 0,
        max: 1,
        default: 0.3,
        unit: '',
        step: 0.01,
        group: 'convolution',
    },
    {
        id: 'convolutionSeparation',
        label: 'Separation',
        min: 0,
        max: 1,
        default: 0.5,
        unit: '',
        step: 0.01,
        group: 'convolution',
    },

    // Macros
    { id: 'macro1', label: 'Macro 1', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'macro' },
    { id: 'macro2', label: 'Macro 2', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'macro' },
    { id: 'macro3', label: 'Macro 3', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'macro' },
    { id: 'macro4', label: 'Macro 4', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'macro' },
    { id: 'macro5', label: 'Macro 5', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'macro' },
    { id: 'macro6', label: 'Macro 6', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'macro' },
    { id: 'macro7', label: 'Macro 7', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'macro' },
    { id: 'macro8', label: 'Macro 8', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'macro' },

    // XY Morph
    { id: 'morphX', label: 'Morph X', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'morph' },
    { id: 'morphY', label: 'Morph Y', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'morph' },

    // Global modulation
    {
        id: 'lfo1Rate',
        label: 'LFO 1 Rate',
        min: 0.01,
        max: 40,
        default: 2,
        unit: 'Hz',
        group: 'modulation',
        scaling: 'log',
    },
    { id: 'lfo1Shape', label: 'LFO 1 Shape', min: 0, max: 4, default: 0, unit: '', step: 1, group: 'modulation' },
    { id: 'lfo1Amount', label: 'LFO 1 Amt', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'modulation' },
    {
        id: 'lfo2Rate',
        label: 'LFO 2 Rate',
        min: 0.01,
        max: 40,
        default: 0.5,
        unit: 'Hz',
        group: 'modulation',
        scaling: 'log',
    },
    { id: 'lfo2Shape', label: 'LFO 2 Shape', min: 0, max: 4, default: 1, unit: '', step: 1, group: 'modulation' },
    { id: 'lfo2Amount', label: 'LFO 2 Amt', min: 0, max: 1, default: 0.5, unit: '', step: 0.01, group: 'modulation' },
    {
        id: 'envFollowerAttack',
        label: 'Env Atk',
        min: 0.1,
        max: 100,
        default: 5,
        unit: 'ms',
        group: 'modulation',
        scaling: 'log',
    },
    {
        id: 'envFollowerRelease',
        label: 'Env Rel',
        min: 1,
        max: 2000,
        default: 200,
        unit: 'ms',
        group: 'modulation',
        scaling: 'log',
    },

    // Per-band gain (exposed for automation)
    { id: 'bandGain', label: 'Band Gain', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'band' },
];

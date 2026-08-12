/**
 * Fermenter patch data model.
 * Describes the complete state of the synth — serializable, versionable.
 */

export type FermenterPatch = {
    version: number;
    name: string;

    // Oscillator
    oscEngine: number; // 0=wavetable, 1=VA, 2=FM, 3=Karplus-Strong, 4=Granular, 5=Additive, 6=Sampler
    oscWaveform: number; // 0=sine, 1=saw, 2=square, 3=triangle
    oscLevel: number; // 0–1
    oscCoarse: number; // -24 to +24 semitones
    oscFine: number; // -100 to +100 cents
    pulseWidth: number; // 0.05–0.95 (VA square only)

    // Unison
    unisonVoices: number; // 1–16
    unisonDetune: number; // 0–100 cents
    unisonSpread: number; // 0–1 stereo width

    // Noise
    noiseLevel: number; // 0–1
    noiseColor: number; // 0=white, 1=pink, 2=brown

    // Filter
    // Analog drift
    oscDrift: number; // 0–1 (analog pitch instability amount)

    // Time-domain warp
    warpMode: number; // 0=none, 1=sync, 2=quantize, 3=squeeze, 4=bend, 5=formant, 6=fold
    warpAmount: number; // 0–1

    // Audio-rate modulation
    audioModRate: number; // 0–5000 Hz
    audioModDepth: number; // 0–1
    audioModTarget: number; // 0=off, 1=pitch(FM), 2=amplitude(AM), 3=filter

    // Additive params (active when oscEngine=5)
    additivePartials: number; // 1–64
    additiveTilt: number; // -6 to 6 (spectral tilt dB/oct)
    additiveOdd: number; // 0–1 (odd harmonic emphasis)
    additiveInharm: number; // 0–0.1 (inharmonicity)

    // Sampler params (active when oscEngine=6)
    samplerMode: number; // 0=oneshot, 1=loop, 2=pingpong
    samplerStart: number; // 0–1
    samplerEnd: number; // 0–1

    // Per-voice FX
    voiceDrive: number; // 0–10 (per-voice distortion)

    filterModel: number; // 0=SVF, 1=Moog, 2=Diode, 3=Formant, 4=MS-20, 5=SEM

    // Karplus-Strong params (active when oscEngine=3)
    ksDamping: number; // 0–0.99 (string decay rate)
    ksBrightness: number; // 0.1–1 (excitation brightness)

    // Granular params (active when oscEngine=4)
    grainDensity: number; // 1–100 (grains per second)
    grainSize: number; // 5–500 (grain duration ms)
    grainPosition: number; // 0–1 (scan position in wavetable)
    grainSpray: number; // 0–1 (position randomization)
    grainPitchVar: number; // 0–12 (pitch variation semitones)
    grainPanSpread: number; // 0–1 (stereo spread)
    filterMode: number; // 0=LP, 1=HP, 2=BP, 3=Notch (SVF only — Moog/Diode are always LP)
    filterCutoff: number; // 20–20000 Hz
    filterResonance: number; // 0.5–20
    filterDrive: number; // 0–10 (saturation amount)
    filterKeytrack: number; // 0–1 (how much note pitch affects cutoff)

    // FM Engine (active when oscEngine=2)
    fmAlgorithm: number; // 0–7 preset routing
    fmRatio1: number; // Op 1 freq ratio (0.5–16)
    fmRatio2: number; // Op 2 freq ratio
    fmRatio3: number; // Op 3 freq ratio
    fmRatio4: number; // Op 4 freq ratio
    fmLevel1: number; // Op 1 level (0–1)
    fmLevel2: number; // Op 2 level
    fmLevel3: number; // Op 3 level
    fmLevel4: number; // Op 4 level
    fmFeedback: number; // Global feedback (0–1)
    fmModAmount: number; // Global mod depth multiplier (0–4)

    // Amp envelope
    ampAttack: number; // 0.001–5 s
    ampDecay: number; // 0.001–5 s
    ampSustain: number; // 0–1
    ampRelease: number; // 0.001–10 s

    // Filter envelope
    filterAttack: number;
    filterDecay: number;
    filterSustain: number;
    filterRelease: number;
    filterEnvAmount: number; // -1 to 1

    // LFO
    lfoRate: number; // 0–5000 Hz
    lfoShape: number; // 0=sine, 1=tri, 2=saw, 3=square
    lfoPitchAmount: number; // -1 to 1
    lfoFilterAmount: number; // -1 to 1

    // MSEG modulation
    msegToFilter: number; // -1 to 1 (MSEG → filter cutoff amount)

    // Step Sequencer
    seqRate: number; // 0.5–20 Hz
    seqToPitch: number; // -1 to 1 (step seq → pitch amount)

    // Portamento
    portamentoTime: number; // 0–2 s (0 = off)
    portamentoMode: number; // 0=always, 1=legato only

    // Effects — Reverb
    reverbType: number; // 0=Plate, 1=FDN
    reverbMix: number; // 0–1
    reverbDecay: number; // 0–0.99

    // EQ (3-band parametric)
    eqLowFreq: number; // 20–500
    eqLowGain: number; // -24 to 24 dB
    eqLowQ: number; // 0.1–10
    eqMidFreq: number; // 200–8000
    eqMidGain: number;
    eqMidQ: number;
    eqHighFreq: number; // 2000–20000
    eqHighGain: number;
    eqHighQ: number;

    // Effects — Delay
    delayTime: number; // 10–2000 ms
    delayFeedback: number; // 0–0.95
    delayMix: number; // 0–1

    // Effects — Chorus
    chorusRate: number; // 0.1–5 Hz
    chorusDepth: number; // 0–1
    chorusMix: number; // 0–1

    // Effects — Phaser
    phaserRate: number; // 0.1–5 Hz
    phaserDepth: number; // 0–1
    phaserMix: number; // 0–1

    // Effects — Distortion
    distDrive: number; // 0–10
    distTone: number; // 0–1
    distMix: number; // 0–1

    // Effects — Compressor
    compThreshold: number; // -60 to 0 dB
    compRatio: number; // 1–20
    compAttack: number; // 0.1–100 ms
    compRelease: number; // 10–1000 ms
    compMix: number; // 0–1

    // Stereo Width
    stereoWidth: number; // 0–2 (0=mono, 1=natural, 2=extra wide)

    // Chaos modulators (Tier 4)
    chaosAmount: number; // 0–1 (Lorenz/Perlin modulation intensity)
    chaosSpeed: number; // 0.01–10 (chaos evolution speed)

    // Layer management
    activeLayer: number; // 0–3 (which layer receives edits)
    numLayers: number; // 1–4 (how many layers are active)
    layerLevel: number; // 0–1 (current layer's volume)
    layerPan: number; // -1 to 1 (current layer's pan)

    // Master
    masterGain: number; // 0–2

    // Macros (musical labels)
    macros: [number, number, number, number, number, number, number, number];
    macroMappings?: FermenterMacroMapping[];
};

export type FermenterMacroCurve = 'linear' | 'exponential';

export type FermenterMacroTarget = {
    target: keyof FermenterPatch;
    center: number;
    depth: number;
    min: number;
    max: number;
    curve: FermenterMacroCurve;
};

export type FermenterMacroMapping = {
    targets: FermenterMacroTarget[];
};

export const DEFAULT_MACRO_MAPPINGS: FermenterMacroMapping[] = [
    { targets: [{ target: 'filterCutoff', center: 6_090, depth: 5_910, min: 180, max: 12_000, curve: 'exponential' }] },
    { targets: [{ target: 'lfoFilterAmount', center: 0, depth: 1, min: -1, max: 1, curve: 'linear' }] },
    { targets: [{ target: 'stereoWidth', center: 1.15, depth: 0.7, min: 0.45, max: 1.85, curve: 'linear' }] },
    {
        targets: [
            { target: 'distDrive', center: 4, depth: 4, min: 0, max: 8, curve: 'linear' },
            { target: 'distMix', center: 0.275, depth: 0.275, min: 0, max: 0.55, curve: 'linear' },
        ],
    },
    { targets: [{ target: 'reverbMix', center: 0.35, depth: 0.35, min: 0, max: 0.7, curve: 'linear' }] },
    {
        targets: [
            { target: 'compMix', center: 0.325, depth: 0.325, min: 0, max: 0.65, curve: 'linear' },
            { target: 'compThreshold', center: -20, depth: -12, min: -32, max: -8, curve: 'linear' },
        ],
    },
    { targets: [{ target: 'warpAmount', center: 0.5, depth: 0.5, min: 0, max: 1, curve: 'linear' }] },
    { targets: [{ target: 'chaosAmount', center: 0.5, depth: 0.5, min: 0, max: 1, curve: 'linear' }] },
];

export const DEFAULT_PATCH: FermenterPatch = {
    version: 1,
    name: 'Init',

    oscEngine: 0,
    oscWaveform: 1,
    oscLevel: 0.8,
    oscCoarse: 0,
    oscFine: 0,
    pulseWidth: 0.5,

    unisonVoices: 1,
    unisonDetune: 15,
    unisonSpread: 0.7,

    noiseLevel: 0.0,
    noiseColor: 0,

    oscDrift: 0.0,

    warpMode: 0,
    warpAmount: 0.0,

    audioModRate: 0.0,
    audioModDepth: 0.0,
    audioModTarget: 0,

    additivePartials: 32,
    additiveTilt: 0.0,
    additiveOdd: 0.0,
    additiveInharm: 0.0,

    samplerMode: 0,
    samplerStart: 0.0,
    samplerEnd: 1.0,

    voiceDrive: 0.0,

    filterModel: 0,

    ksDamping: 0.5,
    ksBrightness: 0.7,

    grainDensity: 20,
    grainSize: 50,
    grainPosition: 0,
    grainSpray: 0.1,
    grainPitchVar: 0,
    grainPanSpread: 0.5,
    filterMode: 0,
    filterCutoff: 5000,
    filterResonance: 1.0,
    filterDrive: 0.0,
    filterKeytrack: 0.0,

    fmAlgorithm: 0,
    fmRatio1: 1.0,
    fmRatio2: 2.0,
    fmRatio3: 3.0,
    fmRatio4: 4.0,
    fmLevel1: 1.0,
    fmLevel2: 0.8,
    fmLevel3: 0.5,
    fmLevel4: 0.3,
    fmFeedback: 0.0,
    fmModAmount: 1.0,

    ampAttack: 0.01,
    ampDecay: 0.2,
    ampSustain: 0.7,
    ampRelease: 0.3,

    filterAttack: 0.01,
    filterDecay: 0.3,
    filterSustain: 0.0,
    filterRelease: 0.3,
    filterEnvAmount: 0.5,

    lfoRate: 0.0,
    lfoShape: 0,
    lfoPitchAmount: 0.0,
    lfoFilterAmount: 0.0,

    msegToFilter: 0.0,

    seqRate: 4.0,
    seqToPitch: 0.0,

    portamentoTime: 0.0,
    portamentoMode: 0,

    reverbType: 0,
    reverbMix: 0.2,
    reverbDecay: 0.5,

    eqLowFreq: 100,
    eqLowGain: 0,
    eqLowQ: 1.0,
    eqMidFreq: 1000,
    eqMidGain: 0,
    eqMidQ: 1.0,
    eqHighFreq: 8000,
    eqHighGain: 0,
    eqHighQ: 1.0,

    delayTime: 375,
    delayFeedback: 0.35,
    delayMix: 0.0,

    chorusRate: 1.2,
    chorusDepth: 0.4,
    chorusMix: 0.0,

    phaserRate: 0.5,
    phaserDepth: 0.5,
    phaserMix: 0.0,

    distDrive: 0.0,
    distTone: 0.5,
    distMix: 0.0,

    compThreshold: -20,
    compRatio: 4,
    compAttack: 10,
    compRelease: 100,
    compMix: 0.0,

    stereoWidth: 1.0,

    chaosAmount: 0.0,
    chaosSpeed: 1.0,

    activeLayer: 0,
    numLayers: 1,
    layerLevel: 1.0,
    layerPan: 0.0,

    masterGain: 1.0,

    macros: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    macroMappings: DEFAULT_MACRO_MAPPINGS,
};

/** Parameter metadata for UI rendering */
export type FermenterParamDef = {
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

export const FERMENTER_PARAMS: readonly FermenterParamDef[] = [
    // Oscillator
    { id: 'oscEngine', label: 'Engine', min: 0, max: 6, default: 0, unit: '', step: 1, group: 'osc' },
    { id: 'oscWaveform', label: 'Waveform', min: 0, max: 3, default: 1, unit: '', step: 1, group: 'osc' },
    { id: 'oscLevel', label: 'Osc Level', min: 0, max: 1, default: 0.8, unit: '', group: 'osc' },
    { id: 'oscCoarse', label: 'Coarse', min: -24, max: 24, default: 0, unit: 'st', step: 1, group: 'osc' },
    { id: 'oscFine', label: 'Fine', min: -100, max: 100, default: 0, unit: 'ct', group: 'osc' },
    { id: 'pulseWidth', label: 'Pulse Width', min: 0.05, max: 0.95, default: 0.5, unit: '', group: 'osc' },

    // Unison
    { id: 'unisonVoices', label: 'Unison', min: 1, max: 16, default: 1, unit: '', step: 1, group: 'unison' },
    { id: 'unisonDetune', label: 'Detune', min: 0, max: 100, default: 15, unit: 'ct', group: 'unison' },
    { id: 'unisonSpread', label: 'Spread', min: 0, max: 1, default: 0.7, unit: '', group: 'unison' },

    // Noise
    { id: 'noiseLevel', label: 'Noise', min: 0, max: 1, default: 0, unit: '', group: 'noise' },
    { id: 'noiseColor', label: 'Color', min: 0, max: 2, default: 0, unit: '', step: 1, group: 'noise' },

    // Drift
    { id: 'oscDrift', label: 'Drift', min: 0, max: 1, default: 0, unit: '', group: 'osc' },

    // Time-Domain Warp
    { id: 'warpMode', label: 'Warp Mode', min: 0, max: 6, default: 0, unit: '', step: 1, group: 'warp' },
    { id: 'warpAmount', label: 'Warp Amount', min: 0, max: 1, default: 0, unit: '', group: 'warp' },

    // Audio-Rate Modulation
    { id: 'audioModRate', label: 'AM/FM Rate', min: 0, max: 5000, default: 0, unit: 'Hz', group: 'audiomod' },
    { id: 'audioModDepth', label: 'AM/FM Depth', min: 0, max: 1, default: 0, unit: '', group: 'audiomod' },
    { id: 'audioModTarget', label: 'AM/FM Target', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'audiomod' },

    // Additive
    { id: 'additivePartials', label: 'Partials', min: 1, max: 64, default: 32, unit: '', step: 1, group: 'additive' },
    { id: 'additiveTilt', label: 'Tilt', min: -6, max: 6, default: 0, unit: 'dB', group: 'additive' },
    { id: 'additiveOdd', label: 'Odd Emphasis', min: 0, max: 1, default: 0, unit: '', group: 'additive' },
    { id: 'additiveInharm', label: 'Inharmonicity', min: 0, max: 0.1, default: 0, unit: '', group: 'additive' },

    // Karplus-Strong
    { id: 'ksDamping', label: 'Damping', min: 0, max: 0.99, default: 0.5, unit: '', group: 'ks' },
    { id: 'ksBrightness', label: 'Brightness', min: 0.1, max: 1, default: 0.7, unit: '', group: 'ks' },

    // Granular
    { id: 'grainDensity', label: 'Density', min: 1, max: 100, default: 20, unit: 'g/s', group: 'granular' },
    { id: 'grainSize', label: 'Size', min: 5, max: 500, default: 50, unit: 'ms', group: 'granular' },
    { id: 'grainPosition', label: 'Position', min: 0, max: 1, default: 0, unit: '', group: 'granular' },
    { id: 'grainSpray', label: 'Spray', min: 0, max: 1, default: 0.1, unit: '', group: 'granular' },
    { id: 'grainPitchVar', label: 'Pitch Var', min: 0, max: 12, default: 0, unit: 'st', group: 'granular' },
    { id: 'grainPanSpread', label: 'Pan Spread', min: 0, max: 1, default: 0.5, unit: '', group: 'granular' },

    // Sampler
    { id: 'samplerMode', label: 'Play Mode', min: 0, max: 2, default: 0, unit: '', step: 1, group: 'sampler' },
    { id: 'samplerStart', label: 'Start', min: 0, max: 1, default: 0, unit: '', group: 'sampler' },
    { id: 'samplerEnd', label: 'End', min: 0, max: 1, default: 1, unit: '', group: 'sampler' },

    // Per-voice FX
    { id: 'voiceDrive', label: 'Voice Drive', min: 0, max: 10, default: 0, unit: '', group: 'voicefx' },

    // Filter
    { id: 'filterModel', label: 'Filter Model', min: 0, max: 5, default: 0, unit: '', step: 1, group: 'filter' },
    {
        id: 'filterCutoff',
        label: 'Cutoff',
        min: 20,
        max: 20000,
        default: 5000,
        unit: 'Hz',
        group: 'filter',
        scaling: 'log',
    },
    { id: 'filterResonance', label: 'Resonance', min: 0.5, max: 20, default: 1, unit: '', group: 'filter' },
    { id: 'filterMode', label: 'Filter Type', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'filter' },
    { id: 'filterDrive', label: 'Drive', min: 0, max: 10, default: 0, unit: '', group: 'filter' },
    { id: 'filterKeytrack', label: 'Key Track', min: 0, max: 1, default: 0, unit: '', group: 'filter' },
    { id: 'filterEnvAmount', label: 'Env → Filter', min: -1, max: 1, default: 0.5, unit: '', group: 'filter' },

    // FM Engine
    { id: 'fmAlgorithm', label: 'FM Algorithm', min: 0, max: 7, default: 0, unit: '', step: 1, group: 'fm' },
    { id: 'fmRatio1', label: 'Op1 Ratio', min: 0.5, max: 16, default: 1, unit: '', group: 'fm' },
    { id: 'fmRatio2', label: 'Op2 Ratio', min: 0.5, max: 16, default: 2, unit: '', group: 'fm' },
    { id: 'fmRatio3', label: 'Op3 Ratio', min: 0.5, max: 16, default: 3, unit: '', group: 'fm' },
    { id: 'fmRatio4', label: 'Op4 Ratio', min: 0.5, max: 16, default: 4, unit: '', group: 'fm' },
    { id: 'fmLevel1', label: 'Op1 Level', min: 0, max: 1, default: 1, unit: '', group: 'fm' },
    { id: 'fmLevel2', label: 'Op2 Level', min: 0, max: 1, default: 0.8, unit: '', group: 'fm' },
    { id: 'fmLevel3', label: 'Op3 Level', min: 0, max: 1, default: 0.5, unit: '', group: 'fm' },
    { id: 'fmLevel4', label: 'Op4 Level', min: 0, max: 1, default: 0.3, unit: '', group: 'fm' },
    { id: 'fmFeedback', label: 'FM Feedback', min: 0, max: 1, default: 0, unit: '', group: 'fm' },
    { id: 'fmModAmount', label: 'FM Depth', min: 0, max: 4, default: 1, unit: '', group: 'fm' },

    // Amp ADSR
    { id: 'ampAttack', label: 'Attack', min: 0.001, max: 5, default: 0.01, unit: 's', group: 'ampEnv', scaling: 'log' },
    { id: 'ampDecay', label: 'Decay', min: 0.001, max: 5, default: 0.2, unit: 's', group: 'ampEnv', scaling: 'log' },
    { id: 'ampSustain', label: 'Sustain', min: 0, max: 1, default: 0.7, unit: '', group: 'ampEnv' },
    {
        id: 'ampRelease',
        label: 'Release',
        min: 0.001,
        max: 10,
        default: 0.3,
        unit: 's',
        group: 'ampEnv',
        scaling: 'log',
    },

    // Filter ADSR
    {
        id: 'filterAttack',
        label: 'Filter Attack',
        min: 0.001,
        max: 5,
        default: 0.01,
        unit: 's',
        group: 'filterEnv',
        scaling: 'log',
    },
    {
        id: 'filterDecay',
        label: 'Filter Decay',
        min: 0.001,
        max: 5,
        default: 0.3,
        unit: 's',
        group: 'filterEnv',
        scaling: 'log',
    },
    { id: 'filterSustain', label: 'Filter Sustain', min: 0, max: 1, default: 0, unit: '', group: 'filterEnv' },
    {
        id: 'filterRelease',
        label: 'Filter Release',
        min: 0.001,
        max: 10,
        default: 0.3,
        unit: 's',
        group: 'filterEnv',
        scaling: 'log',
    },

    // LFO
    { id: 'lfoRate', label: 'LFO Rate', min: 0, max: 5000, default: 0, unit: 'Hz', group: 'lfo' },
    { id: 'lfoShape', label: 'LFO Shape', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'lfo' },
    { id: 'lfoPitchAmount', label: 'LFO → Pitch', min: -1, max: 1, default: 0, unit: '', group: 'lfo' },
    { id: 'lfoFilterAmount', label: 'LFO → Filter', min: -1, max: 1, default: 0, unit: '', group: 'lfo' },

    // MSEG
    { id: 'msegToFilter', label: 'MSEG → Filter', min: -1, max: 1, default: 0, unit: '', group: 'mseg' },

    // Step Sequencer
    { id: 'seqRate', label: 'Seq Rate', min: 0.5, max: 20, default: 4, unit: 'Hz', group: 'stepseq', scaling: 'log' },
    { id: 'seqToPitch', label: 'Seq → Pitch', min: -1, max: 1, default: 0, unit: '', group: 'stepseq' },

    // Portamento
    { id: 'portamentoTime', label: 'Glide', min: 0, max: 2, default: 0, unit: 's', group: 'porta' },
    { id: 'portamentoMode', label: 'Glide Mode', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'porta' },

    // Reverb
    { id: 'reverbType', label: 'Reverb Type', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'reverb' },
    { id: 'reverbMix', label: 'Reverb', min: 0, max: 1, default: 0.2, unit: '', group: 'reverb' },
    { id: 'reverbDecay', label: 'Reverb Decay', min: 0, max: 0.99, default: 0.5, unit: '', group: 'reverb' },

    // EQ
    { id: 'eqLowFreq', label: 'Low Freq', min: 20, max: 500, default: 100, unit: 'Hz', group: 'eq', scaling: 'log' },
    { id: 'eqLowGain', label: 'Low Gain', min: -24, max: 24, default: 0, unit: 'dB', group: 'eq' },
    { id: 'eqLowQ', label: 'Low Q', min: 0.1, max: 10, default: 1, unit: '', group: 'eq' },
    { id: 'eqMidFreq', label: 'Mid Freq', min: 200, max: 8000, default: 1000, unit: 'Hz', group: 'eq', scaling: 'log' },
    { id: 'eqMidGain', label: 'Mid Gain', min: -24, max: 24, default: 0, unit: 'dB', group: 'eq' },
    { id: 'eqMidQ', label: 'Mid Q', min: 0.1, max: 10, default: 1, unit: '', group: 'eq' },
    {
        id: 'eqHighFreq',
        label: 'High Freq',
        min: 2000,
        max: 20000,
        default: 8000,
        unit: 'Hz',
        group: 'eq',
        scaling: 'log',
    },
    { id: 'eqHighGain', label: 'High Gain', min: -24, max: 24, default: 0, unit: 'dB', group: 'eq' },
    { id: 'eqHighQ', label: 'High Q', min: 0.1, max: 10, default: 1, unit: '', group: 'eq' },

    // Delay
    {
        id: 'delayTime',
        label: 'Delay Time',
        min: 10,
        max: 2000,
        default: 375,
        unit: 'ms',
        group: 'delay',
        scaling: 'log',
    },
    { id: 'delayFeedback', label: 'Delay Feedback', min: 0, max: 0.95, default: 0.35, unit: '', group: 'delay' },
    { id: 'delayMix', label: 'Delay Mix', min: 0, max: 1, default: 0, unit: '', group: 'delay' },

    // Chorus
    { id: 'chorusRate', label: 'Chorus Rate', min: 0.1, max: 5, default: 1.2, unit: 'Hz', group: 'chorus' },
    { id: 'chorusDepth', label: 'Chorus Depth', min: 0, max: 1, default: 0.4, unit: '', group: 'chorus' },
    { id: 'chorusMix', label: 'Chorus Mix', min: 0, max: 1, default: 0, unit: '', group: 'chorus' },

    // Phaser
    { id: 'phaserRate', label: 'Phaser Rate', min: 0.1, max: 5, default: 0.5, unit: 'Hz', group: 'phaser' },
    { id: 'phaserDepth', label: 'Phaser Depth', min: 0, max: 1, default: 0.5, unit: '', group: 'phaser' },
    { id: 'phaserMix', label: 'Phaser Mix', min: 0, max: 1, default: 0, unit: '', group: 'phaser' },

    // Distortion
    { id: 'distDrive', label: 'Dist Drive', min: 0, max: 10, default: 0, unit: '', group: 'distortion' },
    { id: 'distTone', label: 'Dist Tone', min: 0, max: 1, default: 0.5, unit: '', group: 'distortion' },
    { id: 'distMix', label: 'Dist Mix', min: 0, max: 1, default: 0, unit: '', group: 'distortion' },

    // Compressor
    { id: 'compThreshold', label: 'Comp Threshold', min: -60, max: 0, default: -20, unit: 'dB', group: 'compressor' },
    { id: 'compRatio', label: 'Comp Ratio', min: 1, max: 20, default: 4, unit: ':1', group: 'compressor' },
    {
        id: 'compAttack',
        label: 'Comp Attack',
        min: 0.1,
        max: 100,
        default: 10,
        unit: 'ms',
        group: 'compressor',
        scaling: 'log',
    },
    {
        id: 'compRelease',
        label: 'Comp Release',
        min: 10,
        max: 1000,
        default: 100,
        unit: 'ms',
        group: 'compressor',
        scaling: 'log',
    },
    { id: 'compMix', label: 'Comp Mix', min: 0, max: 1, default: 0, unit: '', group: 'compressor' },

    // Stereo Width
    { id: 'stereoWidth', label: 'Width', min: 0, max: 2, default: 1, unit: '', group: 'width' },

    // Layer
    { id: 'activeLayer', label: 'Active Layer', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'layer' },
    { id: 'numLayers', label: 'Layers', min: 1, max: 4, default: 1, unit: '', step: 1, group: 'layer' },
    { id: 'layerLevel', label: 'Layer Level', min: 0, max: 1, default: 1, unit: '', group: 'layer' },
    { id: 'layerPan', label: 'Layer Pan', min: -1, max: 1, default: 0, unit: '', group: 'layer' },

    // Chaos
    { id: 'chaosAmount', label: 'Chaos', min: 0, max: 1, default: 0, unit: '', group: 'chaos' },
    { id: 'chaosSpeed', label: 'Chaos Speed', min: 0.01, max: 10, default: 1, unit: '', group: 'chaos' },

    // Master
    { id: 'masterGain', label: 'Master', min: 0, max: 2, default: 1, unit: '', group: 'master' },
];

/** Macro label presets */
export const MACRO_LABELS = [
    'Brightness',
    'Motion',
    'Width',
    'Dirt',
    'Space',
    'Punch',
    'Texture',
    'Character',
] as const;

/** Engine type names */
export const ENGINE_NAMES = ['Wavetable', 'Analog', 'FM', 'String', 'Granular', 'Additive', 'Sampler'] as const;

/** Filter model names */
export const FILTER_MODEL_NAMES = [
    'SVF (Clean)',
    'Moog (Warm)',
    'Diode (Acid)',
    'Formant (Vowel)',
    'MS-20 (Grit)',
    'SEM (Cream)',
] as const;

/** FM algorithm names */
export const FM_ALGORITHM_NAMES = [
    'Stack (4→3→2→1)',
    'Pairs (2→1, 4→3)',
    'Y (3→1, 4→2→1)',
    'Additive (all)',
    'Fork (4→2,3→1)',
    'Split + FB',
    'Stack + FB',
    'Mixed',
] as const;

/** Waveform names */
export const WAVEFORM_NAMES = ['Sine', 'Saw', 'Square', 'Triangle'] as const;

/** Filter mode names */
export const FILTER_MODE_NAMES = ['Low Pass', 'High Pass', 'Band Pass', 'Notch'] as const;

/** LFO shape names */
export const LFO_SHAPE_NAMES = ['Sine', 'Triangle', 'Saw', 'Square'] as const;

/** Noise color names */
export const NOISE_COLOR_NAMES = ['White', 'Pink', 'Brown'] as const;

/** Time-domain warp mode names */
export const WARP_MODE_NAMES = ['Off', 'Sync', 'Quantize', 'Squeeze', 'Bend', 'Formant', 'Fold'] as const;

/** Audio-rate modulation target names */
export const AUDIO_MOD_TARGET_NAMES = ['Off', 'Pitch (FM)', 'Amp (AM)', 'Filter'] as const;

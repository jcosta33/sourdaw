/**
 * Fermenter patch data model.
 * Describes the complete state of the synth — serializable, versionable.
 */

export type FermenterPatch = {
    version: number;
    name: string;

    // Oscillator
    oscEngine: number;       // 0=wavetable, 1=VA (PolyBLEP)
    oscWaveform: number;     // 0=sine, 1=saw, 2=square, 3=triangle
    oscLevel: number;        // 0–1
    oscCoarse: number;       // -24 to +24 semitones
    oscFine: number;         // -100 to +100 cents
    pulseWidth: number;      // 0.05–0.95 (VA square only)

    // Unison
    unisonVoices: number;    // 1–16
    unisonDetune: number;    // 0–100 cents
    unisonSpread: number;    // 0–1 stereo width

    // Noise
    noiseLevel: number;      // 0–1
    noiseColor: number;      // 0=white, 1=pink, 2=brown

    // Filter
    filterMode: number;      // 0=LP, 1=HP, 2=BP, 3=Notch
    filterCutoff: number;    // 20–20000 Hz
    filterResonance: number; // 0.5–20
    filterDrive: number;     // 0–10 (saturation amount)
    filterKeytrack: number;  // 0–1 (how much note pitch affects cutoff)

    // Amp envelope
    ampAttack: number;       // 0.001–5 s
    ampDecay: number;        // 0.001–5 s
    ampSustain: number;      // 0–1
    ampRelease: number;      // 0.001–10 s

    // Filter envelope
    filterAttack: number;
    filterDecay: number;
    filterSustain: number;
    filterRelease: number;
    filterEnvAmount: number; // -1 to 1

    // LFO
    lfoRate: number;         // 0–20 Hz
    lfoShape: number;        // 0=sine, 1=tri, 2=saw, 3=square
    lfoPitchAmount: number;  // -1 to 1
    lfoFilterAmount: number; // -1 to 1

    // Portamento
    portamentoTime: number;  // 0–2 s (0 = off)
    portamentoMode: number;  // 0=always, 1=legato only

    // Effects — Reverb
    reverbMix: number;       // 0–1
    reverbDecay: number;     // 0–0.99

    // Effects — Delay
    delayTime: number;       // 10–2000 ms
    delayFeedback: number;   // 0–0.95
    delayMix: number;        // 0–1

    // Effects — Chorus
    chorusRate: number;      // 0.1–5 Hz
    chorusDepth: number;     // 0–1
    chorusMix: number;       // 0–1

    // Master
    masterGain: number;      // 0–2

    // Macros (musical labels)
    macros: [number, number, number, number, number, number, number, number];
};

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

    filterMode: 0,
    filterCutoff: 5000,
    filterResonance: 1.0,
    filterDrive: 0.0,
    filterKeytrack: 0.0,

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

    portamentoTime: 0.0,
    portamentoMode: 0,

    reverbMix: 0.2,
    reverbDecay: 0.5,

    delayTime: 375,
    delayFeedback: 0.35,
    delayMix: 0.0,

    chorusRate: 1.2,
    chorusDepth: 0.4,
    chorusMix: 0.0,

    masterGain: 1.0,

    macros: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
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
};

export const FERMENTER_PARAMS: readonly FermenterParamDef[] = [
    // Oscillator
    { id: 'oscEngine', label: 'Engine', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'osc' },
    { id: 'oscWaveform', label: 'Waveform', min: 0, max: 3, default: 1, unit: '', step: 1, group: 'osc' },
    { id: 'oscLevel', label: 'Osc Level', min: 0, max: 1, default: 0.8, unit: '', group: 'osc' },
    { id: 'oscCoarse', label: 'Coarse', min: -24, max: 24, default: 0, unit: 'st', step: 1, group: 'osc' },
    { id: 'oscFine', label: 'Fine', min: -100, max: 100, default: 0, unit: 'ct', step: 1, group: 'osc' },
    { id: 'pulseWidth', label: 'Pulse Width', min: 0.05, max: 0.95, default: 0.5, unit: '', group: 'osc' },

    // Unison
    { id: 'unisonVoices', label: 'Unison', min: 1, max: 16, default: 1, unit: '', step: 1, group: 'unison' },
    { id: 'unisonDetune', label: 'Detune', min: 0, max: 100, default: 15, unit: 'ct', group: 'unison' },
    { id: 'unisonSpread', label: 'Spread', min: 0, max: 1, default: 0.7, unit: '', group: 'unison' },

    // Noise
    { id: 'noiseLevel', label: 'Noise', min: 0, max: 1, default: 0, unit: '', group: 'noise' },
    { id: 'noiseColor', label: 'Color', min: 0, max: 2, default: 0, unit: '', step: 1, group: 'noise' },

    // Filter
    { id: 'filterCutoff', label: 'Cutoff', min: 20, max: 20000, default: 5000, unit: 'Hz', group: 'filter' },
    { id: 'filterResonance', label: 'Resonance', min: 0.5, max: 20, default: 1, unit: '', group: 'filter' },
    { id: 'filterMode', label: 'Filter Type', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'filter' },
    { id: 'filterDrive', label: 'Drive', min: 0, max: 10, default: 0, unit: '', group: 'filter' },
    { id: 'filterKeytrack', label: 'Key Track', min: 0, max: 1, default: 0, unit: '', group: 'filter' },
    { id: 'filterEnvAmount', label: 'Env → Filter', min: -1, max: 1, default: 0.5, unit: '', group: 'filter' },

    // Amp ADSR
    { id: 'ampAttack', label: 'Attack', min: 0.001, max: 5, default: 0.01, unit: 's', group: 'ampEnv' },
    { id: 'ampDecay', label: 'Decay', min: 0.001, max: 5, default: 0.2, unit: 's', group: 'ampEnv' },
    { id: 'ampSustain', label: 'Sustain', min: 0, max: 1, default: 0.7, unit: '', group: 'ampEnv' },
    { id: 'ampRelease', label: 'Release', min: 0.001, max: 10, default: 0.3, unit: 's', group: 'ampEnv' },

    // Filter ADSR
    { id: 'filterAttack', label: 'Filter Attack', min: 0.001, max: 5, default: 0.01, unit: 's', group: 'filterEnv' },
    { id: 'filterDecay', label: 'Filter Decay', min: 0.001, max: 5, default: 0.3, unit: 's', group: 'filterEnv' },
    { id: 'filterSustain', label: 'Filter Sustain', min: 0, max: 1, default: 0, unit: '', group: 'filterEnv' },
    { id: 'filterRelease', label: 'Filter Release', min: 0.001, max: 10, default: 0.3, unit: 's', group: 'filterEnv' },

    // LFO
    { id: 'lfoRate', label: 'LFO Rate', min: 0, max: 20, default: 0, unit: 'Hz', group: 'lfo' },
    { id: 'lfoShape', label: 'LFO Shape', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'lfo' },
    { id: 'lfoPitchAmount', label: 'LFO → Pitch', min: -1, max: 1, default: 0, unit: '', group: 'lfo' },
    { id: 'lfoFilterAmount', label: 'LFO → Filter', min: -1, max: 1, default: 0, unit: '', group: 'lfo' },

    // Portamento
    { id: 'portamentoTime', label: 'Glide', min: 0, max: 2, default: 0, unit: 's', group: 'porta' },
    { id: 'portamentoMode', label: 'Glide Mode', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'porta' },

    // Reverb
    { id: 'reverbMix', label: 'Reverb', min: 0, max: 1, default: 0.2, unit: '', group: 'reverb' },
    { id: 'reverbDecay', label: 'Reverb Decay', min: 0, max: 0.99, default: 0.5, unit: '', group: 'reverb' },

    // Delay
    { id: 'delayTime', label: 'Delay Time', min: 10, max: 2000, default: 375, unit: 'ms', group: 'delay' },
    { id: 'delayFeedback', label: 'Delay Feedback', min: 0, max: 0.95, default: 0.35, unit: '', group: 'delay' },
    { id: 'delayMix', label: 'Delay Mix', min: 0, max: 1, default: 0, unit: '', group: 'delay' },

    // Chorus
    { id: 'chorusRate', label: 'Chorus Rate', min: 0.1, max: 5, default: 1.2, unit: 'Hz', group: 'chorus' },
    { id: 'chorusDepth', label: 'Chorus Depth', min: 0, max: 1, default: 0.4, unit: '', group: 'chorus' },
    { id: 'chorusMix', label: 'Chorus Mix', min: 0, max: 1, default: 0, unit: '', group: 'chorus' },

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
export const ENGINE_NAMES = ['Wavetable', 'Analog'] as const;

/** Waveform names */
export const WAVEFORM_NAMES = ['Sine', 'Saw', 'Square', 'Triangle'] as const;

/** Filter mode names */
export const FILTER_MODE_NAMES = ['Low Pass', 'High Pass', 'Band Pass', 'Notch'] as const;

/** LFO shape names */
export const LFO_SHAPE_NAMES = ['Sine', 'Triangle', 'Saw', 'Square'] as const;

/** Noise color names */
export const NOISE_COLOR_NAMES = ['White', 'Pink', 'Brown'] as const;

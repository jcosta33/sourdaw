/**
 * Gluten compressor patch — all parameter definitions and defaults.
 */

export type GlutenTopology = 'vca' | 'opto' | 'fet' | 'diode';

export type GlutenStyle = 'glue' | 'punch' | 'smooth' | 'pump';

export type GlutenPatch = {
    name: string;

    // Core compressor
    topology: GlutenTopology;
    style: GlutenStyle;
    amount: number; // 0 – 100 (Level 1 macro: maps to threshold + ratio)
    threshold: number; // dB (-60 to 0)
    ratio: number; // 1:1 to 20:1
    attack: number; // ms (0.02 – 250)
    release: number; // ms (25 – 5000)
    knee: number; // dB (0 – 30)
    makeup: number; // dB (-12 to +24)
    mix: number; // 0 – 1
    autoMakeup: boolean;
    autoRelease: boolean;
    range: number; // dB (0 – 60, caps max GR)

    // Sidechain
    scHpfFreq: number; // Hz (20 – 500)
    scHpfEnabled: boolean;
    thrust: number; // 0 = off, 1 = medium, 2 = loud

    // Detection
    detection: 'rms' | 'peak';

    // Stereo
    stereoMode: 'stereo' | 'mid' | 'side' | 'dual-mono';
    stereoLink: number; // 0 – 1

    // Advanced
    oversampling: number; // 1, 2, or 4
    lookahead: number; // ms (0 – 20)
    scLpfFreq: number; // Hz (1000 – 20000)
    scLpfEnabled: boolean;
    scEqFreq: number; // Hz (20 – 20000)
    scEqGain: number; // dB (-18 – +18)
    scEqQ: number; // 0.1 – 10
    scEqEnabled: boolean;
    deltaListen: boolean;
    gainMatchBypass: boolean;
    extSidechain: boolean;

    // FET-specific
    inputGain: number; // dB
    outputGain: number; // dB
    xfmrDrive: number; // 0 – 3
    allButtons: boolean;

    // Opto-specific
    limitMode: boolean;

    // Diode-specific
    recovery: number; // 1 – 5

    // VCA-specific
    vcaType: number; // 0 = Ideal, 1 = THAT 2181, 2 = DBX 202
    vcaCharacter: number; // 0 – 0.02
    feedForward: boolean; // VCA: false = feedback/SSL, true = feed-forward

    // FET harmonic controls
    jfetK3: number; // 0 – 0.5 (odd harmonic amount)
    xfmrK2: number; // 0 – 0.3 (even harmonic amount from transformer)

    // Dual-stage blend (Shadow Hills style)
    blendTopology: GlutenTopology;
    blendAmount: number; // 0 – 1 (0 = single, 1 = full dual-stage)
};

export const DEFAULT_PATCH: GlutenPatch = {
    name: 'Init',
    topology: 'vca',
    style: 'glue',
    amount: 50,
    threshold: -18,
    ratio: 4,
    attack: 10,
    release: 300,
    knee: 6,
    makeup: 0,
    mix: 1,
    autoMakeup: false,
    autoRelease: true,
    range: 15,
    scHpfFreq: 80,
    scHpfEnabled: true,
    thrust: 0,
    detection: 'rms',
    stereoMode: 'stereo',
    stereoLink: 1,
    oversampling: 2,
    lookahead: 0,
    scLpfFreq: 20000,
    scLpfEnabled: false,
    scEqFreq: 1000,
    scEqGain: 0,
    scEqQ: 1,
    scEqEnabled: false,
    deltaListen: false,
    gainMatchBypass: false,
    extSidechain: false,
    inputGain: 0,
    outputGain: 0,
    xfmrDrive: 1.2,
    allButtons: false,
    limitMode: false,
    recovery: 3,
    vcaType: 1,
    vcaCharacter: 0.003,
    feedForward: false,
    jfetK3: 0.15,
    xfmrK2: 0.0,
    blendTopology: 'opto',
    blendAmount: 0,
};

export type GlutenParamDef = {
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

export const GLUTEN_PARAMS: readonly GlutenParamDef[] = [
    // Core
    { id: 'topology', label: 'Topology', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'core' },
    { id: 'amount', label: 'Amount', min: 0, max: 100, default: 50, unit: '%', step: 1, group: 'core' },
    { id: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, unit: 'dB', step: 0.5, group: 'core' },
    { id: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, unit: ':1', step: 0.5, group: 'core' },
    { id: 'attack', label: 'Attack', min: 0.02, max: 250, default: 10, unit: 'ms', step: 0.1, group: 'core', scaling: 'log' },
    { id: 'release', label: 'Release', min: 25, max: 5000, default: 300, unit: 'ms', step: 1, group: 'core', scaling: 'log' },
    { id: 'knee', label: 'Knee', min: 0, max: 30, default: 6, unit: 'dB', step: 0.5, group: 'core' },
    { id: 'makeup', label: 'Makeup', min: -12, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'core' },
    { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'core' },
    { id: 'autoMakeup', label: 'Auto Makeup', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'core' },
    { id: 'autoRelease', label: 'Auto Release', min: 0, max: 1, default: 1, unit: '', step: 1, group: 'core' },
    // Advanced
    { id: 'range', label: 'Range', min: 0, max: 60, default: 15, unit: 'dB', step: 1, group: 'advanced' },
    { id: 'lookahead', label: 'Lookahead', min: 0, max: 20, default: 0, unit: 'ms', step: 0.5, group: 'advanced' },
    { id: 'deltaListen', label: 'Delta Listen', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'advanced' },
    // Sidechain
    { id: 'scHpfFreq', label: 'SC HPF', min: 20, max: 500, default: 80, unit: 'Hz', step: 1, group: 'sidechain', scaling: 'log' },
    { id: 'scHpfEnabled', label: 'SC HPF On', min: 0, max: 1, default: 1, unit: '', step: 1, group: 'sidechain' },
    { id: 'thrust', label: 'Thrust', min: 0, max: 2, default: 0, unit: '', step: 1, group: 'sidechain' },
    { id: 'detection', label: 'Detection', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'sidechain' },
    {
        id: 'scLpfFreq',
        label: 'SC LPF',
        min: 1000,
        max: 20000,
        default: 20000,
        unit: 'Hz',
        step: 100,
        group: 'sidechain',
        scaling: 'log',
    },
    { id: 'scLpfEnabled', label: 'SC LPF On', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'sidechain' },
    // Stereo
    { id: 'stereoLink', label: 'Stereo Link', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'stereo' },
    { id: 'stereoMode', label: 'Stereo Mode', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'stereo' },
    // FET-specific
    { id: 'inputGain', label: 'Input Gain', min: -12, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'fet' },
    { id: 'outputGain', label: 'Output Gain', min: -24, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'fet' },
    { id: 'xfmrDrive', label: 'Transformer', min: 0, max: 3, default: 1.2, unit: '', step: 0.01, group: 'fet' },
    { id: 'allButtons', label: 'All Buttons', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'fet' },
    // Opto-specific
    { id: 'limitMode', label: 'Limit Mode', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'opto' },
    // Diode-specific
    { id: 'recovery', label: 'Recovery', min: 1, max: 5, default: 3, unit: '', step: 1, group: 'diode' },
    // VCA-specific
    { id: 'vcaCharacter', label: 'VCA Color', min: 0, max: 0.02, default: 0.003, unit: '', step: 0.001, group: 'vca' },
    { id: 'feedForward', label: 'Feed-Forward', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'vca' },
    // Dual-stage blend
    { id: 'blendTopology', label: 'Blend Topo', min: 0, max: 3, default: 1, unit: '', step: 1, group: 'route' },
    { id: 'blendAmount', label: 'Blend', min: 0, max: 1, default: 0, unit: '', step: 0.01, group: 'route' },
    // Bypass
    { id: 'gainMatchBypass', label: 'Gain Match', min: 0, max: 1, default: 0, unit: '', step: 1, group: 'advanced' },
];

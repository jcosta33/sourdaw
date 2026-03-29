/**
 * Gluten compressor patch — all parameter definitions and defaults.
 */

export type GlutenTopology = 'vca' | 'opto' | 'fet' | 'diode';

export type GlutenStyle = 'glue' | 'punch' | 'smooth' | 'pump';

export type GlutenPatch = {
    name: string;

    // Core compressor
    topology: GlutenTopology;
    threshold: number;    // dB (-60 to 0)
    ratio: number;        // 1:1 to 20:1
    attack: number;       // ms (0.02 – 250)
    release: number;      // ms (25 – 5000)
    knee: number;         // dB (0 – 30)
    makeup: number;       // dB (-12 to +24)
    mix: number;          // 0 – 1
    autoMakeup: boolean;
    autoRelease: boolean;
    range: number;        // dB (0 – 60, caps max GR)

    // Sidechain
    scHpfFreq: number;   // Hz (20 – 500)
    scHpfEnabled: boolean;
    thrust: number;       // 0 = off, 1 = medium, 2 = loud

    // Detection
    detection: 'rms' | 'peak';

    // Stereo
    stereoMode: 'stereo' | 'mid' | 'side' | 'dual-mono';
    stereoLink: number;   // 0 – 1

    // Advanced
    lookahead: number;    // ms (0 – 20)

    // FET-specific
    inputGain: number;    // dB
    outputGain: number;   // dB
    xfmrDrive: number;   // 0 – 3
    allButtons: boolean;

    // Opto-specific
    limitMode: boolean;

    // Diode-specific
    recovery: number;     // 1 – 5

    // VCA-specific
    vcaCharacter: number; // 0 – 0.02
};

export const DEFAULT_PATCH: GlutenPatch = {
    name: 'Init',
    topology: 'vca',
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
    lookahead: 0,
    inputGain: 0,
    outputGain: 0,
    xfmrDrive: 1.2,
    allButtons: false,
    limitMode: false,
    recovery: 3,
    vcaCharacter: 0.003,
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
};

export const GLUTEN_PARAMS: readonly GlutenParamDef[] = [
    { id: 'topology', label: 'Topology', min: 0, max: 3, default: 0, unit: '', step: 1, group: 'core' },
    { id: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, unit: 'dB', step: 0.5, group: 'core' },
    { id: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, unit: ':1', step: 0.5, group: 'core' },
    { id: 'attack', label: 'Attack', min: 0.02, max: 250, default: 10, unit: 'ms', step: 0.1, group: 'core' },
    { id: 'release', label: 'Release', min: 25, max: 5000, default: 300, unit: 'ms', step: 1, group: 'core' },
    { id: 'knee', label: 'Knee', min: 0, max: 30, default: 6, unit: 'dB', step: 0.5, group: 'core' },
    { id: 'makeup', label: 'Makeup', min: -12, max: 24, default: 0, unit: 'dB', step: 0.5, group: 'core' },
    { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'core' },
    { id: 'range', label: 'Range', min: 0, max: 60, default: 15, unit: 'dB', step: 1, group: 'advanced' },
    { id: 'scHpfFreq', label: 'SC HPF', min: 20, max: 500, default: 80, unit: 'Hz', step: 1, group: 'sidechain' },
    { id: 'stereoLink', label: 'Stereo Link', min: 0, max: 1, default: 1, unit: '', step: 0.01, group: 'stereo' },
    { id: 'lookahead', label: 'Lookahead', min: 0, max: 20, default: 0, unit: 'ms', step: 0.5, group: 'advanced' },
];

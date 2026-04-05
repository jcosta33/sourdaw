/**
 * Crust — limiter/saturator patch model.
 * All parameter definitions, defaults, and the CRUST_PARAMS list.
 */

export type CrustAlgorithm = 'transparent' | 'punchy' | 'dynamic' | 'allround' | 'aggressive' | 'bus' | 'safe' | 'wall';

export type CrustSatAlgorithm = 'soft' | 'hard' | 'tape' | 'tube' | 'fold';

export type CrustMultiBand = 'wideband' | '3band' | '5band';

export type CrustStereoMode = 'stereo' | 'ms';

export type CrustDither = 'off' | 'tpdf16' | 'tpdf24' | 'powr1' | 'powr2' | 'powr3';

export type CrustScrollSpeed = 'slow' | 'normal' | 'fast';

export type CrustStreamingPreset =
    | 'spotify'
    | 'youtube'
    | 'tidal'
    | 'amazon'
    | 'ebu_r128'
    | 'atsc_a85'
    | 'cd_master'
    | 'club_dance'
    | 'hifi'
    | 'custom';

export type CrustPatch = {
    name: string;

    // Level 1 — PLAY
    gain: number; // 0 – 18 dB (input gain / "push" control)
    ceiling: number; // -6 to 0 dBTP
    style: 'transparent' | 'punchy' | 'loud'; // L1 simplification

    // Level 2 — SHAPE
    algorithm: CrustAlgorithm;
    lookahead: number; // 0 – 10 ms
    attack: number; // 0 – 100 ms (0 = auto)
    release: number; // 0 – 1000 ms (0 = auto)
    attackAuto: boolean;
    releaseAuto: boolean;
    channelLinkTransient: number; // 0 – 100 %
    channelLinkRelease: number; // 0 – 100 %
    truePeak: boolean;
    oversampling: 1 | 4 | 8 | 16 | 32;

    // Level 3 — BUILD
    satEnabled: boolean;
    satAlgorithm: CrustSatAlgorithm;
    satDrive: number; // 0 – 18 dB
    satMix: number; // 0 – 100 %
    deltaListen: boolean;
    unityGain: boolean;

    // Level 4 — ROUTE
    multiBand: CrustMultiBand;
    crossover1: number; // Hz (default 80)
    crossover2: number; // Hz (default 2000)
    scHpfEnabled: boolean;
    scHpfFreq: number; // 20 – 200 Hz
    stereoMode: CrustStereoMode;
    dither: CrustDither;
    outputBitDepth: 16 | 24 | 32;

    // Level 5 — LAB
    // (curve data handled in UI state, not serialised here)
    abSlot: 'a' | 'b';

    // UI
    uiLevel: 1 | 2 | 3 | 4 | 5;
    scrollSpeed: CrustScrollSpeed;
    streamingPreset: CrustStreamingPreset;
};

export const DEFAULT_CRUST_PATCH: CrustPatch = {
    name: 'Init',
    gain: 0,
    ceiling: -0.3,
    style: 'transparent',
    algorithm: 'transparent',
    lookahead: 2,
    attack: 0,
    release: 0,
    attackAuto: true,
    releaseAuto: true,
    channelLinkTransient: 100,
    channelLinkRelease: 100,
    truePeak: true,
    oversampling: 4,
    satEnabled: false,
    satAlgorithm: 'soft',
    satDrive: 0,
    satMix: 0,
    deltaListen: false,
    unityGain: false,
    multiBand: 'wideband',
    crossover1: 80,
    crossover2: 2000,
    scHpfEnabled: false,
    scHpfFreq: 60,
    stereoMode: 'stereo',
    dither: 'off',
    outputBitDepth: 24,
    abSlot: 'a',
    uiLevel: 2,
    scrollSpeed: 'normal',
    streamingPreset: 'spotify',
};

// ── Flat param list for DeviceParameter descriptor ─────────────────────────

export type CrustParamDef = {
    id: string;
    label: string;
    min: number;
    max: number;
    default: number;
    unit: string;
    step?: number;
};

export const CRUST_PARAMS: readonly CrustParamDef[] = [
    { id: 'gain', label: 'Gain', min: 0, max: 18, default: 0, unit: 'dB', step: 0.1 },
    { id: 'ceiling', label: 'Ceiling', min: -6, max: 0, default: -0.3, unit: 'dBTP', step: 0.1 },
    { id: 'lookahead', label: 'Lookahead', min: 0, max: 10, default: 2, unit: 'ms', step: 0.1 },
    { id: 'attack', label: 'Attack', min: 0, max: 100, default: 0, unit: 'ms', step: 0.1 },
    { id: 'release', label: 'Release', min: 0, max: 1000, default: 0, unit: 'ms', step: 1 },
    { id: 'channelLinkTransient', label: 'Link Trans', min: 0, max: 100, default: 100, unit: '%', step: 1 },
    { id: 'channelLinkRelease', label: 'Link Rel', min: 0, max: 100, default: 100, unit: '%', step: 1 },
    { id: 'truePeak', label: 'True Peak', min: 0, max: 1, default: 1, unit: '', step: 1 },
    { id: 'oversampling', label: 'Oversampling', min: 1, max: 32, default: 4, unit: 'x', step: 1 },
    { id: 'satDrive', label: 'Sat Drive', min: 0, max: 18, default: 0, unit: 'dB', step: 0.1 },
    { id: 'satMix', label: 'Sat Mix', min: 0, max: 100, default: 0, unit: '%', step: 1 },
    { id: 'deltaListen', label: 'Delta', min: 0, max: 1, default: 0, unit: '', step: 1 },
    { id: 'scHpfFreq', label: 'SC HPF', min: 20, max: 200, default: 60, unit: 'Hz', step: 1 },
];

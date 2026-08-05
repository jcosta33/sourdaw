/**
 * Crust — limiter/saturator patch model.
 * Patch shape and defaults. The flat DeviceParameter descriptor lives in the
 * Arrangement module (models/PluginDescriptors/CrustDescriptor.ts).
 */

export type CrustAlgorithm = 'transparent' | 'punchy' | 'dynamic' | 'allround' | 'aggressive' | 'bus' | 'safe' | 'wall';

export type CrustSatAlgorithm = 'soft' | 'hard' | 'tape' | 'tube' | 'fold';

export type CrustMultiBand = 'wideband' | '3band' | '5band';

export type CrustStereoMode = 'stereo' | 'ms';

export type CrustDither = 'off' | 'tpdf16' | 'tpdf24' | 'powr1' | 'powr2' | 'powr3';

export type CrustScrollSpeed = 'slow' | 'normal' | 'fast';

/**
 * The oversampling factors the engine distinguishes, ascending.
 *
 * One list, because it had been three: the panel offered `[1, 4, 8, 16, 32]`,
 * this type spelled the same five out, and the preset spec kept its own copy —
 * so 2x, which `crates/daw-dsp/src/crust/oversample.rs` has always built a
 * stage for, was unreachable from every surface in the product. The panel row,
 * the patch type and the preset guard now all read this.
 *
 * The Arrangement descriptor declares the same set a second time
 * (`PluginDescriptors/CrustDescriptor.ts` — models do not cross module
 * boundaries, so that duplication is deliberate); `CrustPatch.spec.ts` holds
 * the two to each other.
 */
export const CRUST_OVERSAMPLE_FACTORS = [1, 2, 4, 8, 16, 32] as const;

export type CrustOversampleFactor = (typeof CRUST_OVERSAMPLE_FACTORS)[number];

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
    oversampling: CrustOversampleFactor;

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
    uiLevel: 2,
    scrollSpeed: 'normal',
    streamingPreset: 'spotify',
};

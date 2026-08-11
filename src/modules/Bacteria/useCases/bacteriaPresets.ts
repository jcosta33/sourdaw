/**
 * Bacteria factory presets — character-first defaults that sound alive immediately.
 */
import { type BacteriaPatch, type BacteriaBand, DEFAULT_PATCH, DEFAULT_BAND } from '../models/BacteriaPatch';

export type BacteriaPreset = {
    id: string;
    name: string;
    category: string;
    patch: BacteriaPatch;
};

function band(overrides: Partial<BacteriaBand>): BacteriaBand {
    return { ...DEFAULT_BAND, ...overrides };
}

function preset(id: string, name: string, category: string, overrides: Partial<BacteriaPatch>): BacteriaPreset {
    return { id, name, category, patch: { ...DEFAULT_PATCH, ...overrides, name } };
}

export const BACTERIA_PRESETS: readonly BacteriaPreset[] = [
    // ── Distortion ───────────────────────────────────────────────────────────
    preset('bac-warm-tape', 'Warm Tape', 'Saturation', {
        bandCount: 1,
        bands: [
            band({ distortionEnabled: true, distortionMode: 'soft-clip', drive: 35, asymmetry: 0.15 }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),
    preset('bac-tube-crunch', 'Tube Crunch', 'Saturation', {
        bandCount: 1,
        bands: [
            band({ distortionEnabled: true, distortionMode: 'tube', drive: 55, tubeBias: 0.6 }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),
    preset('bac-fold-mangler', 'Fold Mangler', 'Destruction', {
        bandCount: 3,
        crossoverFreq1: 300,
        crossoverFreq2: 3000,
        bands: [
            band({ distortionEnabled: true, distortionMode: 'foldback', drive: 70, foldbackThreshold: 0.4 }),
            band({ distortionEnabled: true, distortionMode: 'soft-clip', drive: 45 }),
            band({ distortionEnabled: true, distortionMode: 'wavefold', drive: 60 }),
            ...Array.from({ length: 3 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),
    preset('bac-breakdown', 'Sub Breakdown', 'Destruction', {
        bandCount: 2,
        crossoverFreq1: 500,
        bands: [
            band({ distortionEnabled: true, distortionMode: 'breakdown', drive: 80, breakdownDepth: 2 }),
            band({ distortionEnabled: true, distortionMode: 'soft-clip', drive: 30 }),
            ...Array.from({ length: 4 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),

    // ── Filter ───────────────────────────────────────────────────────────────
    preset('bac-breathing-filter', 'Breathing Filter', 'Filter', {
        bandCount: 1,
        bands: [
            band({
                filterEnabled: true,
                filterMode: 'lowpass',
                filterCutoff: 3000,
                filterResonance: 0.5,
                filterEnvAmount: 0.6,
                filterEnvAttack: 15,
                filterEnvRelease: 400,
            }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),
    preset('bac-resonant-sweep', 'Resonant Sweep', 'Filter', {
        bandCount: 1,
        bands: [
            band({
                filterEnabled: true,
                filterMode: 'bandpass',
                filterCutoff: 1500,
                filterResonance: 0.7,
            }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),

    // ── Granular ─────────────────────────────────────────────────────────────
    preset('bac-grain-cloud', 'Grain Cloud', 'Granular', {
        bandCount: 1,
        bands: [
            band({
                granularEnabled: true,
                grainSize: 60,
                grainDensity: 40,
                grainPosOffset: 200,
                grainPitch: 0,
                grainMix: 0.6,
            }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),
    preset('bac-frozen-texture', 'Frozen Texture', 'Granular', {
        bandCount: 1,
        bands: [
            band({
                granularEnabled: true,
                grainSize: 120,
                grainDensity: 25,
                grainPitch: 7,
                grainMix: 0.8,
            }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),

    // ── Spectral ─────────────────────────────────────────────────────────────
    preset('bac-spectral-wash', 'Spectral Wash', 'Spectral', {
        bandCount: 1,
        bands: [
            band({
                spectralEnabled: true,
                spectralBlur: 0.8,
                spectralMix: 0.6,
            }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),
    preset('bac-metallic-shift', 'Metallic Shift', 'Spectral', {
        bandCount: 1,
        bands: [
            band({
                freqShiftEnabled: true,
                freqShiftHz: 12,
                freqShiftMix: 0.4,
                distortionEnabled: true,
                distortionMode: 'soft-clip',
                drive: 20,
            }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),

    // ── Lo-Fi ────────────────────────────────────────────────────────────────
    preset('bac-codec-decay', 'Codec Decay', 'Lo-Fi', {
        bandCount: 1,
        bands: [
            band({
                lofiEnabled: true,
                lofiAmount: 60,
                codecArtifact: 0.5,
            }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),
    preset('bac-bitcrush-cascade', 'Bitcrush Cascade', 'Lo-Fi', {
        bandCount: 3,
        crossoverFreq1: 400,
        crossoverFreq2: 4000,
        bands: [
            band({
                lofiEnabled: true,
                lofiAmount: 20,
                distortionEnabled: true,
                distortionMode: 'bitcrush',
                bitDepth: 12,
            }),
            band({
                lofiEnabled: true,
                lofiAmount: 50,
                distortionEnabled: true,
                distortionMode: 'bitcrush',
                bitDepth: 8,
            }),
            band({
                lofiEnabled: true,
                lofiAmount: 80,
                distortionEnabled: true,
                distortionMode: 'bitcrush',
                bitDepth: 4,
            }),
            ...Array.from({ length: 3 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),

    // ── Multi-band creative ──────────────────────────────────────────────────
    preset('bac-multiband-mangle', 'Multiband Mangle', 'Creative', {
        bandCount: 4,
        crossoverFreq1: 200,
        crossoverFreq2: 1200,
        crossoverFreq3: 5000,
        bands: [
            band({ distortionEnabled: true, distortionMode: 'soft-clip', drive: 60 }),
            band({
                distortionEnabled: true,
                distortionMode: 'foldback',
                drive: 40,
                filterEnabled: true,
                filterMode: 'bandpass',
                filterCutoff: 800,
            }),
            band({ granularEnabled: true, grainSize: 50, grainDensity: 30, grainMix: 0.4 }),
            band({ distortionEnabled: true, distortionMode: 'bitcrush', bitDepth: 6, drive: 30 }),
            ...Array.from({ length: 2 }, () => ({ ...DEFAULT_BAND })),
        ],
        mix: 0.7,
    }),
    preset('bac-mid-side-sculpt', 'Mid/Side Sculpt', 'Creative', {
        bandCount: 1,
        globalRouting: 'mid-side',
        bands: [
            band({
                distortionEnabled: true,
                distortionMode: 'soft-clip',
                drive: 30,
                filterEnabled: true,
                filterMode: 'highpass',
                filterCutoff: 300,
            }),
            ...Array.from({ length: 5 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),

    // ── Performance ──────────────────────────────────────────────────────────
    preset('bac-performance-init', 'Performance Init', 'Performance', {
        bandCount: 3,
        crossoverFreq1: 250,
        crossoverFreq2: 4000,
        macro1: 0,
        macro2: 0,
        macro3: 0.5,
        macro4: 0.5,
        bands: [
            band({ distortionEnabled: true, distortionMode: 'soft-clip', drive: 20 }),
            band({ filterEnabled: true, filterMode: 'bandpass', filterCutoff: 2000, filterResonance: 0.4 }),
            band({ chorusEnabled: true, chorusRate: 2, chorusDepth: 0.3, chorusMix: 0.3 }),
            ...Array.from({ length: 3 }, () => ({ ...DEFAULT_BAND })),
        ],
    }),
];

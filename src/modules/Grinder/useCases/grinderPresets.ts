/**
 * Grinder factory presets — classic amp tones and rig configurations.
 */
import { type GrinderPatch, DEFAULT_PATCH } from '../models/GrinderPatch';

export type GrinderPreset = {
    id: string;
    name: string;
    category: string;
    patch: GrinderPatch;
};

function preset(id: string, name: string, category: string, overrides: Partial<GrinderPatch>): GrinderPreset {
    return { id, name, category, patch: { ...DEFAULT_PATCH, ...overrides, name } };
}

export const GRINDER_PRESETS: readonly GrinderPreset[] = [
    // ── Clean ────────────────────────────────────────────────────────────────
    preset('gr-clean-twin', 'Clean Twin', 'Clean', {
        ampModel: 'clean-twin',
        toneStackType: 'fender',
        gain: 3,
        channel: 0,
        master: 6,
        bass: 6,
        mid: 5,
        treble: 7,
        powerTubeType: '6l6',
        rectifierType: 'solid-state',
        sagAmount: 0.1,
    }),
    preset('gr-clean-sparkle', 'Sparkle Clean', 'Clean', {
        ampModel: 'clean-twin',
        toneStackType: 'fender',
        gain: 4,
        channel: 0,
        bright: true,
        master: 5,
        bass: 4,
        mid: 6,
        treble: 8,
        presence: 7,
        powerTubeType: '6l6',
    }),

    // ── Crunch ───────────────────────────────────────────────────────────────
    preset('gr-british-crunch', 'British Crunch', 'Crunch', {
        ampModel: 'crunch-jcm',
        toneStackType: 'marshall',
        gain: 6,
        channel: 1,
        master: 5,
        bass: 5,
        mid: 7,
        treble: 6,
        powerTubeType: 'el34',
        sagAmount: 0.4,
    }),
    preset('gr-ac30-jangle', 'AC30 Jangle', 'Crunch', {
        ampModel: 'ac30-tb',
        toneStackType: 'vox',
        gain: 5,
        channel: 1,
        master: 6,
        bass: 4,
        mid: 5,
        treble: 7,
        powerTubeType: 'el84',
        sagAmount: 0.5,
    }),

    // ── High Gain ────────────────────────────────────────────────────────────
    preset('gr-lead-jcm', 'JCM Lead', 'High Gain', {
        ampModel: 'lead-jcm',
        toneStackType: 'marshall',
        gain: 8,
        channel: 2,
        master: 4,
        bass: 6,
        mid: 6,
        treble: 7,
        presence: 6,
        powerTubeType: 'el34',
        sagAmount: 0.3,
        negFeedback: 0.4,
    }),
    preset('gr-rectifier-heavy', 'Rectifier Heavy', 'High Gain', {
        ampModel: 'rectifier',
        toneStackType: 'marshall',
        gain: 9,
        channel: 2,
        master: 4,
        bass: 7,
        mid: 5,
        treble: 6,
        presence: 5,
        resonance: 6,
        powerTubeType: '6l6',
        rectifierType: 'tube',
        sagAmount: 0.6,
        sagRecovery: 300,
    }),
    preset('gr-time-lead', 'Time Lead', 'Lead', {
        ampModel: 'clean-twin',
        toneStackType: 'fender',
        gain: 6.8,
        channel: 2,
        bright: false,
        fat: true,
        bass: 4.8,
        mid: 7.4,
        treble: 5.1,
        presence: 4.0,
        resonance: 5.2,
        master: 6.2,
        gateEnabled: false,
        inputGain: 2,
        powerTubeType: 'el34',
        rectifierType: 'solid-state',
        sagAmount: 0.18,
        sagRecovery: 120,
        negFeedback: 0.62,
        powerAmpBias: 0.56,
        transformerDrive: 0.38,
        transformerHysteresis: 0.28,
        transformerLfSaturation: 0.28,
        cabEnabled: true,
        cabResonanceFreq: 82,
        cabResonanceQ: 1.8,
        cabDamping: 0.52,
        coneBreakup: 0.18,
        backEmf: 0.14,
        outputGain: 1,
        fxLoopEnabled: true,
        fxLoopMix: 0.22,
        prePedals: [
            {
                id: 'boost1',
                type: 'overdrive',
                enabled: true,
                params: { drive: 3.6, tone: 4.8, level: 8.4 },
            },
            {
                id: 'comp1',
                type: 'compressor',
                enabled: true,
                params: { threshold: -30, ratio: 3.5, attack: 14, release: 220 },
            },
        ],
        fxLoopPedals: [
            {
                id: 'dl1',
                type: 'delay',
                enabled: true,
                params: { time: 430, feedback: 0.34, mix: 0.17 },
            },
            {
                id: 'rv1',
                type: 'reverb',
                enabled: true,
                params: { decay: 0.68, mix: 0.1 },
            },
        ],
    }),

    // ── Pedal combos ─────────────────────────────────────────────────────────
    preset('gr-ts-crunch', 'TS into Crunch', 'Pedal', {
        ampModel: 'crunch-jcm',
        gain: 5,
        channel: 1,
        master: 5,
        prePedals: [{ id: 'ts1', type: 'overdrive', enabled: true, params: { drive: 4, tone: 6, level: 7 } }],
    }),
    preset('gr-fuzz-clean', 'Fuzz into Clean', 'Pedal', {
        ampModel: 'clean-twin',
        toneStackType: 'fender',
        gain: 3,
        channel: 0,
        master: 6,
        prePedals: [{ id: 'fz1', type: 'fuzz', enabled: true, params: { fuzz: 7, tone: 5, level: 6 } }],
    }),

    // ── Performance ──────────────────────────────────────────────────────────
    preset('gr-live-rig', 'Live Rig', 'Performance', {
        ampModel: 'crunch-jcm',
        gain: 6,
        channel: 1,
        master: 5,
        gateEnabled: true,
        gateThreshold: -50,
        prePedals: [
            {
                id: 'comp1',
                type: 'compressor',
                enabled: true,
                params: { threshold: -20, ratio: 4, attack: 10, release: 200 },
            },
            { id: 'od1', type: 'overdrive', enabled: false, params: { drive: 5, tone: 6, level: 5 } },
        ],
        fxLoopPedals: [
            { id: 'dl1', type: 'delay', enabled: true, params: { time: 375, feedback: 0.3, mix: 0.25 } },
            { id: 'rv1', type: 'reverb', enabled: true, params: { decay: 1.5, mix: 0.15 } },
        ],
        fxLoopEnabled: true,
        snapshots: [
            { id: 'clean', name: 'Clean', paramOverrides: { gain: 3 }, bypassStates: { od1: false } },
            { id: 'drive', name: 'Drive', paramOverrides: { gain: 7 }, bypassStates: { od1: true } },
        ],
    }),
];

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
        gain: 4.8,
        channel: 0,
        bright: false,
        fat: true,
        bass: 5.2,
        mid: 8.4,
        treble: 5.2,
        presence: 2.8,
        resonance: 5.4,
        master: 7.1,
        gateEnabled: false,
        inputGain: 0.5,
        powerTubeType: 'el34',
        rectifierType: 'solid-state',
        sagAmount: 0.1,
        sagRecovery: 90,
        negFeedback: 0.52,
        powerAmpBias: 0.58,
        transformerDrive: 0.34,
        transformerHysteresis: 0.18,
        transformerLfSaturation: 0.28,
        cabEnabled: true,
        cabResonanceFreq: 84,
        cabResonanceQ: 2.0,
        cabDamping: 0.48,
        coneBreakup: 0.08,
        backEmf: 0.16,
        outputGain: 1.3,
        limiterThreshold: -1.0,
        prePedals: [
            {
                id: 'comp1',
                type: 'compressor',
                enabled: true,
                params: { threshold: -30, ratio: 2.7, attack: 22, release: 260 },
            },
            {
                id: 'dist1',
                type: 'distortion',
                enabled: true,
                params: { drive: 5.2, tone: 4.1, level: 7.6 },
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
        snapshots: [
            { id: 'clean', name: 'Clean', paramOverrides: { gain: 3 }, bypassStates: { od1: false } },
            { id: 'drive', name: 'Drive', paramOverrides: { gain: 7 }, bypassStates: { od1: true } },
        ],
    }),
];

/**
 * Morph/layer state for the Grand Boule piano plugin.
 *
 * Defines the per-model physical-modeling parameters and the morph state
 * that controls blending between two piano models. Models are pure data
 * descriptors — the actual DSP parameter dispatch happens in the
 * `setGrandBouleMorphPosition` use case.
 */

export type GrandBoulePianoModel = {
    id: string;
    name: string;
    hammerHardnessScale: number;
    hammerMassScale: number;
    soundboardBrightness: number;
    sympatheticLevel: number;
    bodyResonance: number;
    /** Tone color: -1 = dark, 0 = neutral, +1 = bright. */
    toneColor: number;
};

export type GrandBouleMorphState = {
    /** Preset ID for layer A. */
    modelA: string;
    /** Preset ID for layer B. */
    modelB: string;
    /** Morph position: 0.0 = pure A, 1.0 = pure B. */
    morphPosition: number;
    /** Layer balance: -1.0 = A only, 0 = equal, 1.0 = B only. */
    layerBalance: number;
    /** Whether the morph engine is active. */
    enabled: boolean;
};

// ---------------------------------------------------------------------------
// Built-in piano models
// ---------------------------------------------------------------------------

export const BUILTIN_PIANO_MODELS = [
    {
        id: 'steinway-d',
        name: 'Steinway Model D',
        hammerHardnessScale: 1.0,
        hammerMassScale: 1.0,
        soundboardBrightness: 0.55,
        sympatheticLevel: 0.5,
        bodyResonance: 0.6,
        toneColor: 0.0,
    },
    {
        id: 'bosendorfer-imperial',
        name: 'Bösendorfer Imperial',
        hammerHardnessScale: 0.6,
        hammerMassScale: 1.4,
        soundboardBrightness: 0.25,
        sympatheticLevel: 0.8,
        bodyResonance: 0.9,
        toneColor: -0.7,
    },
    {
        id: 'yamaha-cfx',
        name: 'Yamaha CFX',
        hammerHardnessScale: 1.5,
        hammerMassScale: 0.7,
        soundboardBrightness: 0.85,
        sympatheticLevel: 0.3,
        bodyResonance: 0.35,
        toneColor: 0.7,
    },
    {
        id: 'fazioli-f308',
        name: 'Fazioli F308',
        hammerHardnessScale: 1.2,
        hammerMassScale: 0.85,
        soundboardBrightness: 0.75,
        sympatheticLevel: 0.6,
        bodyResonance: 0.5,
        toneColor: 0.4,
    },
] as const satisfies readonly GrandBoulePianoModel[];

export function createDefaultMorphState(): GrandBouleMorphState {
    return {
        modelA: 'steinway-d',
        modelB: 'yamaha-cfx',
        morphPosition: 0.0,
        layerBalance: 0.0,
        enabled: false,
    };
}

/**
 * Look up a built-in piano model by ID. Returns `undefined` when the ID
 * does not match any known model.
 */
export function findPianoModelById(id: string): GrandBoulePianoModel | undefined {
    return BUILTIN_PIANO_MODELS.find((m) => m.id === id);
}

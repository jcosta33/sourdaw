/**
 * Morph/layer state for the Grand Boule piano plugin (spec §3.1).
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
        hammerHardnessScale: 0.85,
        hammerMassScale: 1.15,
        soundboardBrightness: 0.35,
        sympatheticLevel: 0.65,
        bodyResonance: 0.8,
        toneColor: -0.4,
    },
    {
        id: 'yamaha-cfx',
        name: 'Yamaha CFX',
        hammerHardnessScale: 1.15,
        hammerMassScale: 0.9,
        soundboardBrightness: 0.75,
        sympatheticLevel: 0.4,
        bodyResonance: 0.45,
        toneColor: 0.5,
    },
    {
        id: 'fazioli-f308',
        name: 'Fazioli F308',
        hammerHardnessScale: 1.05,
        hammerMassScale: 0.95,
        soundboardBrightness: 0.7,
        sympatheticLevel: 0.55,
        bodyResonance: 0.55,
        toneColor: 0.3,
    },
] as const satisfies readonly GrandBoulePianoModel[];

export const createDefaultMorphState = (): GrandBouleMorphState => ({
    modelA: 'steinway-d',
    modelB: 'yamaha-cfx',
    morphPosition: 0.0,
    layerBalance: 0.0,
    enabled: false,
});

/**
 * Look up a built-in piano model by ID. Returns `undefined` when the ID
 * does not match any known model.
 */
export const findPianoModelById = (
    id: string,
): GrandBoulePianoModel | undefined =>
    BUILTIN_PIANO_MODELS.find((m) => m.id === id);

/**
 * Morph/layer state for the Grand Boule piano plugin.
 *
 * Defines product-authored voicing parameters and the morph state that
 * controls blending between two voicings. Voicings are pure data
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
    /** Product voicing ID for layer A. */
    modelA: string;
    /** Product voicing ID for layer B. */
    modelB: string;
    /** Morph position: 0.0 = pure A, 1.0 = pure B. */
    morphPosition: number;
    /** Balance override: -1 = A, 0 = current morph position, +1 = B. */
    layerBalance: number;
    /** Whether the morph engine is active. */
    enabled: boolean;
};

// ---------------------------------------------------------------------------
// Built-in product voicings
// ---------------------------------------------------------------------------

export const BUILTIN_PIANO_MODELS = [
    {
        id: 'balanced-grand',
        name: 'Balanced Grand',
        hammerHardnessScale: 0.92,
        hammerMassScale: 1.08,
        soundboardBrightness: 0.48,
        sympatheticLevel: 0.58,
        bodyResonance: 0.52,
        toneColor: -0.08,
    },
    {
        id: 'mellow-grand',
        name: 'Mellow Grand',
        hammerHardnessScale: 0.72,
        hammerMassScale: 1.25,
        soundboardBrightness: 0.32,
        sympatheticLevel: 0.74,
        bodyResonance: 0.82,
        toneColor: -0.58,
    },
    {
        id: 'clear-grand',
        name: 'Clear Grand',
        hammerHardnessScale: 1.34,
        hammerMassScale: 0.82,
        soundboardBrightness: 0.78,
        sympatheticLevel: 0.36,
        bodyResonance: 0.42,
        toneColor: 0.56,
    },
    {
        id: 'singing-grand',
        name: 'Singing Grand',
        hammerHardnessScale: 1.12,
        hammerMassScale: 0.94,
        soundboardBrightness: 0.68,
        sympatheticLevel: 0.66,
        bodyResonance: 0.57,
        toneColor: 0.28,
    },
] as const satisfies readonly GrandBoulePianoModel[];

const LEGACY_LOAD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    'steinway-d': 'balanced-grand',
    'bosendorfer-imperial': 'mellow-grand',
    'yamaha-cfx': 'clear-grand',
    'fazioli-f308': 'singing-grand',
});

export function createDefaultMorphState(): GrandBouleMorphState {
    return {
        modelA: 'balanced-grand',
        modelB: 'clear-grand',
        morphPosition: 0.0,
        layerBalance: 0.0,
        enabled: false,
    };
}

/**
 * Look up a built-in product voicing by ID. Legacy IDs are accepted only so
 * existing serialized projects resolve to the corresponding neutral voicing.
 */
export function findPianoModelById(id: string): GrandBoulePianoModel | undefined {
    const canonicalId = LEGACY_LOAD_ALIASES[id] ?? id;
    return BUILTIN_PIANO_MODELS.find((model) => model.id === canonicalId);
}

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
    /** Layer balance: -1.0 = A only, 0 = equal, 1.0 = B only. */
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
        hammerHardnessScale: 1.0,
        hammerMassScale: 1.0,
        soundboardBrightness: 0.55,
        sympatheticLevel: 0.5,
        bodyResonance: 0.6,
        toneColor: 0.0,
    },
    {
        id: 'mellow-grand',
        name: 'Mellow Grand',
        hammerHardnessScale: 0.6,
        hammerMassScale: 1.4,
        soundboardBrightness: 0.25,
        sympatheticLevel: 0.8,
        bodyResonance: 0.9,
        toneColor: -0.7,
    },
    {
        id: 'clear-grand',
        name: 'Clear Grand',
        hammerHardnessScale: 1.5,
        hammerMassScale: 0.7,
        soundboardBrightness: 0.85,
        sympatheticLevel: 0.3,
        bodyResonance: 0.35,
        toneColor: 0.7,
    },
    {
        id: 'singing-grand',
        name: 'Singing Grand',
        hammerHardnessScale: 1.2,
        hammerMassScale: 0.85,
        soundboardBrightness: 0.75,
        sympatheticLevel: 0.6,
        bodyResonance: 0.5,
        toneColor: 0.4,
    },
] as const satisfies readonly GrandBoulePianoModel[];

const LEGACY_PRODUCT_VOICING_IDS: Readonly<Record<string, string>> = Object.freeze({
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
    const canonicalId = LEGACY_PRODUCT_VOICING_IDS[id] ?? id;
    return BUILTIN_PIANO_MODELS.find((model) => model.id === canonicalId);
}

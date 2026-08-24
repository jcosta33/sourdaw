import { type GrandBouleMorphState, type GrandBoulePianoModel, findPianoModelById } from './GrandBouleMorphState';

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function interpolateModels(modelA: GrandBoulePianoModel, modelB: GrandBoulePianoModel, t: number) {
    return {
        hammerHardnessScale: lerp(modelA.hammerHardnessScale, modelB.hammerHardnessScale, t),
        hammerMassScale: lerp(modelA.hammerMassScale, modelB.hammerMassScale, t),
        soundboardBrightness: lerp(modelA.soundboardBrightness, modelB.soundboardBrightness, t),
        sympatheticLevel: lerp(modelA.sympatheticLevel, modelB.sympatheticLevel, t),
        bodyResonance: lerp(modelA.bodyResonance, modelB.bodyResonance, t),
        toneColor: lerp(modelA.toneColor, modelB.toneColor, t),
    };
}

function effectiveMorphPosition(morphPosition: number, layerBalance: number): number {
    const position = Math.max(0, Math.min(1, morphPosition));
    const balance = Math.max(-1, Math.min(1, layerBalance));
    return balance <= 0 ? position * (balance + 1) : position + (1 - position) * balance;
}

function paramsToEntries(params: ReturnType<typeof interpolateModels>) {
    return [
        { name: 'hammer_hardness_scale', value: params.hammerHardnessScale },
        { name: 'hammer_mass_scale', value: params.hammerMassScale },
        { name: 'soundboard_brightness', value: params.soundboardBrightness },
        { name: 'sympathetic_level', value: params.sympatheticLevel },
        { name: 'body_resonance', value: params.bodyResonance },
        { name: 'tone_color', value: params.toneColor },
    ] as const;
}

export function projectGrandBouleMorphState(morph: GrandBouleMorphState) {
    const modelA = findPianoModelById(morph.modelA);
    if (modelA === undefined) {
        return [];
    }
    if (!morph.enabled) {
        return paramsToEntries(interpolateModels(modelA, modelA, 0));
    }
    const modelB = findPianoModelById(morph.modelB);
    if (modelB === undefined) {
        return [];
    }
    return paramsToEntries(
        interpolateModels(modelA, modelB, effectiveMorphPosition(morph.morphPosition, morph.layerBalance))
    );
}

/**
 * Update the Grand Boule morph position and dispatch interpolated
 * physical-modeling parameters to the engine (spec §3.1).
 *
 * Linearly interpolates every numeric model parameter between model A and
 * model B according to the new morph position, then forwards the blended
 * values through `setParam`.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBoulePianoModel, findPianoModelById } from '../models/GrandBouleMorphState';
import { grandBouleStore } from '../stores/grandBouleStore';

type SetGrandBouleMorphPositionInput = {
    engine: GrandBouleEngineHandle;
    morphPosition: number;
};

/**
 * Linearly interpolate a single value between `a` and `b` by `t` (0..1).
 */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Interpolate all numeric physical-modeling parameters between two models.
 */
const interpolateModels = (
    modelA: GrandBoulePianoModel,
    modelB: GrandBoulePianoModel,
    t: number
): {
    hammerHardnessScale: number;
    hammerMassScale: number;
    soundboardBrightness: number;
    sympatheticLevel: number;
    bodyResonance: number;
    toneColor: number;
} => ({
    hammerHardnessScale: lerp(modelA.hammerHardnessScale, modelB.hammerHardnessScale, t),
    hammerMassScale: lerp(modelA.hammerMassScale, modelB.hammerMassScale, t),
    soundboardBrightness: lerp(modelA.soundboardBrightness, modelB.soundboardBrightness, t),
    sympatheticLevel: lerp(modelA.sympatheticLevel, modelB.sympatheticLevel, t),
    bodyResonance: lerp(modelA.bodyResonance, modelB.bodyResonance, t),
    toneColor: lerp(modelA.toneColor, modelB.toneColor, t),
});

/**
 * Push a complete set of interpolated model parameters to the engine.
 */
const dispatchInterpolatedParams = (
    engine: GrandBouleEngineHandle,
    params: ReturnType<typeof interpolateModels>
): void => {
    engine.setParam({ name: 'hammer_hardness_scale', value: params.hammerHardnessScale });
    engine.setParam({ name: 'hammer_mass_scale', value: params.hammerMassScale });
    engine.setParam({ name: 'soundboard_brightness', value: params.soundboardBrightness });
    engine.setParam({ name: 'sympathetic_level', value: params.sympatheticLevel });
    engine.setParam({ name: 'body_resonance', value: params.bodyResonance });
    engine.setParam({ name: 'tone_color', value: params.toneColor });
};

export const setGrandBouleMorphPosition = (input: SetGrandBouleMorphPositionInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }

    const clamped = Math.max(0, Math.min(1, input.morphPosition));

    const morph = state.morph;
    if (morph === undefined) {
        return;
    }

    const modelA = findPianoModelById(morph.modelA);
    if (modelA === undefined) {
        return;
    }

    if (!morph.enabled) {
        // Morph disabled — apply model A's parameters directly so that
        // switching models in the UI always has an audible effect.
        dispatchInterpolatedParams(input.engine, {
            hammerHardnessScale: modelA.hammerHardnessScale,
            hammerMassScale: modelA.hammerMassScale,
            soundboardBrightness: modelA.soundboardBrightness,
            sympatheticLevel: modelA.sympatheticLevel,
            bodyResonance: modelA.bodyResonance,
            toneColor: modelA.toneColor,
        });
        return;
    }

    const modelB = findPianoModelById(morph.modelB);
    if (modelB === undefined) {
        return;
    }

    const interpolated = interpolateModels(modelA, modelB, clamped);
    dispatchInterpolatedParams(input.engine, interpolated);

    grandBouleStore.set({
        ...state,
        morph: { ...morph, morphPosition: clamped },
    });
};

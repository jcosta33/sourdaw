import { logger } from '#/infra/logger/appLogger';
import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule morph position and dispatch interpolated
 * physical-modeling parameters to the engine.
 *
 * Linearly interpolates every numeric model parameter between model A and
 * model B according to the new morph position, then forwards the blended
 * values through `setParam`.
 */

import { type GrandBoulePianoModel, findPianoModelById } from '../models/GrandBouleMorphState';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SetGrandBouleMorphPositionInput = {
    engine: GrandBouleEngineHandle;
    morphPosition: number;
    store: Store<GrandBouleState>;
};

/**
 * Linearly interpolate a single value between `a` and `b` by `t` (0..1).
 */
function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * Interpolate all numeric physical-modeling parameters between two models.
 */
function interpolateModels(
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
} {
    return {
        hammerHardnessScale: lerp(modelA.hammerHardnessScale, modelB.hammerHardnessScale, t),
        hammerMassScale: lerp(modelA.hammerMassScale, modelB.hammerMassScale, t),
        soundboardBrightness: lerp(modelA.soundboardBrightness, modelB.soundboardBrightness, t),
        sympatheticLevel: lerp(modelA.sympatheticLevel, modelB.sympatheticLevel, t),
        bodyResonance: lerp(modelA.bodyResonance, modelB.bodyResonance, t),
        toneColor: lerp(modelA.toneColor, modelB.toneColor, t),
    };
}

/**
 * Push a complete set of interpolated model parameters to the engine.
 */
function dispatchInterpolatedParams(
    engine: GrandBouleEngineHandle,
    params: ReturnType<typeof interpolateModels>
): void {
    engine.setParam({ name: 'hammer_hardness_scale', value: params.hammerHardnessScale });
    engine.setParam({ name: 'hammer_mass_scale', value: params.hammerMassScale });
    engine.setParam({ name: 'soundboard_brightness', value: params.soundboardBrightness });
    engine.setParam({ name: 'sympathetic_level', value: params.sympatheticLevel });
    engine.setParam({ name: 'body_resonance', value: params.bodyResonance });
    engine.setParam({ name: 'tone_color', value: params.toneColor });
}

export function setGrandBouleMorphPosition(input: SetGrandBouleMorphPositionInput): void {
    const state = input.store.value;
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
        logger.warn(`setGrandBouleMorphPosition: unknown morph model A id "${morph.modelA}" — ignoring move`);
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
        // Persist the new position too, or a controlled knob would snap back
        // to the old value on the next render (the engine moved but the store
        // did not).
        input.store.set({
            ...state,
            morph: { ...morph, morphPosition: clamped },
        });
        return;
    }

    const modelB = findPianoModelById(morph.modelB);
    if (modelB === undefined) {
        logger.warn(`setGrandBouleMorphPosition: unknown morph model B id "${morph.modelB}" — ignoring move`);
        return;
    }

    const interpolated = interpolateModels(modelA, modelB, clamped);
    dispatchInterpolatedParams(input.engine, interpolated);

    input.store.set({
        ...state,
        morph: { ...morph, morphPosition: clamped },
    });
}

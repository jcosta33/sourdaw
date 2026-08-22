import { logger } from '#/infra/logger/appLogger';

import {
    type GrandBouleMorphState,
    type GrandBoulePianoModel,
    findPianoModelById,
} from '../models/GrandBouleMorphState';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';

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

function effectiveMorphPosition(morphPosition: number, layerBalance: number): number {
    const position = Math.max(0, Math.min(1, morphPosition));
    const balance = Math.max(-1, Math.min(1, layerBalance));
    return balance <= 0 ? position * (balance + 1) : position + (1 - position) * balance;
}

export function applyGrandBouleMorphState(engine: GrandBouleEngineHandle, morph: GrandBouleMorphState): boolean {
    const modelA = findPianoModelById(morph.modelA);
    if (modelA === undefined) {
        logger.warn(`applyGrandBouleMorphState: unknown morph model A id "${morph.modelA}" - ignoring state`);
        return false;
    }

    if (!morph.enabled) {
        dispatchInterpolatedParams(engine, interpolateModels(modelA, modelA, 0));
        return true;
    }

    const modelB = findPianoModelById(morph.modelB);
    if (modelB === undefined) {
        logger.warn(`applyGrandBouleMorphState: unknown morph model B id "${morph.modelB}" - ignoring state`);
        return false;
    }

    dispatchInterpolatedParams(
        engine,
        interpolateModels(modelA, modelB, effectiveMorphPosition(morph.morphPosition, morph.layerBalance))
    );
    return true;
}

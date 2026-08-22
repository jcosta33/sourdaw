import { logger } from '#/infra/logger/appLogger';

import { type GrandBouleMorphState, findPianoModelById } from '../models/GrandBouleMorphState';
import { projectGrandBouleMorphState } from '../models/ProjectGrandBouleMorphState';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';

function dispatchInterpolatedParams(engine: GrandBouleEngineHandle, morph: GrandBouleMorphState): void {
    for (const parameter of projectGrandBouleMorphState(morph)) {
        engine.setParam(parameter);
    }
}

export function applyGrandBouleMorphState(engine: GrandBouleEngineHandle, morph: GrandBouleMorphState): boolean {
    const modelA = findPianoModelById(morph.modelA);
    if (modelA === undefined) {
        logger.warn(`applyGrandBouleMorphState: unknown morph model A id "${morph.modelA}" - ignoring state`);
        return false;
    }

    if (!morph.enabled) {
        dispatchInterpolatedParams(engine, morph);
        return true;
    }

    const modelB = findPianoModelById(morph.modelB);
    if (modelB === undefined) {
        logger.warn(`applyGrandBouleMorphState: unknown morph model B id "${morph.modelB}" - ignoring state`);
        return false;
    }

    dispatchInterpolatedParams(engine, morph);
    return true;
}

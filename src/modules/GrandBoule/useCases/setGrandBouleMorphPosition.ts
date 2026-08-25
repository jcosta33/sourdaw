import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule morph position and dispatch interpolated
 * product-voicing parameters to the engine.
 *
 * Linearly interpolates every numeric model parameter between model A and
 * model B according to the new morph position, then forwards the blended
 * values through `setParam`.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { dispatchGrandBouleMorphEdit } from './dispatchGrandBouleMorphEdit';

type SetGrandBouleMorphPositionInput = {
    engine: GrandBouleEngineHandle;
    deviceId: string;
    isTransient?: boolean;
    morphPosition: number;
    store: Store<GrandBouleState>;
};

export function setGrandBouleMorphPosition(input: SetGrandBouleMorphPositionInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }

    const clamped = Math.max(0, Math.min(1, input.morphPosition));

    const nextMorph = { ...state.morph, morphPosition: clamped };
    dispatchGrandBouleMorphEdit({
        deviceId: input.deviceId,
        engine: input.engine,
        store: input.store,
        nextMorph,
        isTransient: input.isTransient ?? false,
    });
}

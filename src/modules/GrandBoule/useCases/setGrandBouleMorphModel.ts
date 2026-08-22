import { type Store } from '#/infra/store/types';

import { findPianoModelById } from '../models/GrandBouleMorphState';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { dispatchGrandBouleMorphEdit } from './dispatchGrandBouleMorphEdit';

export function setGrandBouleMorphModel(input: {
    deviceId: string;
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    slot: 'modelA' | 'modelB';
    modelId: string;
}): void {
    const state = input.store.value;
    if (state === null || findPianoModelById(input.modelId) === undefined) {
        return;
    }
    dispatchGrandBouleMorphEdit({
        deviceId: input.deviceId,
        engine: input.engine,
        store: input.store,
        nextMorph: { ...state.morph, [input.slot]: input.modelId },
        isTransient: false,
    });
}

import { type Store } from '#/infra/store/types';

import { type GrandBouleMorphState } from '../models/GrandBouleMorphState';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { applyGrandBouleMorphState } from './applyGrandBouleMorphState';
import { commitGrandBouleDeviceState } from './commitGrandBouleDeviceState';

export function dispatchGrandBouleMorphEdit(input: {
    deviceId: string;
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    nextMorph: GrandBouleMorphState;
    isTransient: boolean;
}): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    if (input.isTransient) {
        if (!applyGrandBouleMorphState(input.engine, input.nextMorph)) {
            return;
        }
        input.store.set({ ...state, morph: input.nextMorph });
        return;
    }
    commitGrandBouleDeviceState(input.deviceId, input.nextMorph);
}

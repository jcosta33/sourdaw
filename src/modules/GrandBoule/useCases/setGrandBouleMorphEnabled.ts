import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { dispatchGrandBouleMorphEdit } from './dispatchGrandBouleMorphEdit';

type SetGrandBouleMorphEnabledInput = {
    enabled: boolean;
    deviceId: string;
    engine: GrandBouleEngineHandle;
    isTransient?: boolean;
    store: Store<GrandBouleState>;
};

export function setGrandBouleMorphEnabled(input: SetGrandBouleMorphEnabledInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }

    const nextMorph = { ...state.morph, enabled: input.enabled };
    dispatchGrandBouleMorphEdit({
        deviceId: input.deviceId,
        engine: input.engine,
        store: input.store,
        nextMorph,
        isTransient: input.isTransient ?? false,
    });
}

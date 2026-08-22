import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { applyGrandBouleMorphState } from './applyGrandBouleMorphState';

type SetGrandBouleMorphEnabledInput = {
    enabled: boolean;
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
};

export function setGrandBouleMorphEnabled(input: SetGrandBouleMorphEnabledInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }

    const nextMorph = { ...state.morph, enabled: input.enabled };
    if (!applyGrandBouleMorphState(input.engine, nextMorph)) {
        return;
    }

    input.store.set({ ...state, morph: nextMorph });
}

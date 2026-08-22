import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { applyGrandBouleMorphState } from './applyGrandBouleMorphState';

type SetGrandBouleMorphBalanceInput = {
    balance: number;
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
};

export function setGrandBouleMorphBalance(input: SetGrandBouleMorphBalanceInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }

    const nextMorph = { ...state.morph, layerBalance: Math.max(-1, Math.min(1, input.balance)) };
    if (!applyGrandBouleMorphState(input.engine, nextMorph)) {
        return;
    }

    input.store.set({ ...state, morph: nextMorph });
}

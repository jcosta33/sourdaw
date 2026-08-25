import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { dispatchGrandBouleMorphEdit } from './dispatchGrandBouleMorphEdit';

type SetGrandBouleMorphBalanceInput = {
    balance: number;
    deviceId: string;
    engine: GrandBouleEngineHandle;
    isTransient?: boolean;
    store: Store<GrandBouleState>;
};

export function setGrandBouleMorphBalance(input: SetGrandBouleMorphBalanceInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }

    const nextMorph = { ...state.morph, layerBalance: Math.max(-1, Math.min(1, input.balance)) };
    dispatchGrandBouleMorphEdit({
        deviceId: input.deviceId,
        engine: input.engine,
        store: input.store,
        nextMorph,
        isTransient: input.isTransient ?? false,
    });
}

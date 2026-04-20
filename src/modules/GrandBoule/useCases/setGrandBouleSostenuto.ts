import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule sostenuto pedal (CC66) state.
 *
 * The engine captures currently-held keys on the rising edge of this
 * pedal; they stay un-damped until the pedal releases.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SetGrandBouleSostenutoInput = {
    engine: GrandBouleEngineHandle;
    engaged: boolean;
    store: Store<GrandBouleState>;
};

export const setGrandBouleSostenuto = (input: SetGrandBouleSostenutoInput): void => {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    input.store.set({
        ...state,
        pedals: { ...state.pedals, sostenuto: input.engaged },
    });
    input.engine.setSostenuto({ engaged: input.engaged });
};

import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule una-corda pedal (CC67) state.
 *
 * Writes the new value to the store and forwards it to the engine handle.
 * Una corda scales hammer stiffness and dampens sympathetic coupling per
 * the piano-plugin spec §5.2.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SetGrandBouleUnaCordaInput = {
    engine: GrandBouleEngineHandle;
    engaged: boolean;
    store: Store<GrandBouleState>;
};

export const setGrandBouleUnaCorda = (input: SetGrandBouleUnaCordaInput): void => {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    input.store.set({
        ...state,
        pedals: { ...state.pedals, unaCorda: input.engaged },
    });
    input.engine.setUnaCorda({ engaged: input.engaged });
};

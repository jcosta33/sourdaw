/**
 * Update the Grand Boule una-corda pedal (CC67) state.
 *
 * Writes the new value to the store and forwards it to the engine handle.
 * Una corda scales hammer stiffness and dampens sympathetic coupling per
 * the piano-plugin spec §5.2.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { grandBouleStore } from '../stores/grandBouleStore';

type SetGrandBouleUnaCordaInput = {
    engine: GrandBouleEngineHandle;
    engaged: boolean;
};

export const setGrandBouleUnaCorda = (input: SetGrandBouleUnaCordaInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    grandBouleStore.set({
        ...state,
        pedals: { ...state.pedals, unaCorda: input.engaged },
    });
    input.engine.setUnaCorda({ engaged: input.engaged });
};

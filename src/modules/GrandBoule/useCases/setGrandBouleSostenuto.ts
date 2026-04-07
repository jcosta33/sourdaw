/**
 * Update the Grand Boule sostenuto pedal (CC66) state.
 *
 * The engine captures currently-held keys on the rising edge of this
 * pedal; they stay un-damped until the pedal releases.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { grandBouleStore } from '../stores/grandBouleStore';

type SetGrandBouleSostenutoInput = {
    engine: GrandBouleEngineHandle;
    engaged: boolean;
};

export const setGrandBouleSostenuto = (input: SetGrandBouleSostenutoInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    grandBouleStore.set({
        ...state,
        pedals: { ...state.pedals, sostenuto: input.engaged },
    });
    input.engine.setSostenuto({ engaged: input.engaged });
};

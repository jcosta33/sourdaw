/**
 * Update the Grand Boule master gain.
 *
 * Writes the new value to the store and forwards it to the engine handle.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { grandBouleStore } from '../stores/grandBouleStore';

type SetGrandBouleMasterGainInput = {
    engine: GrandBouleEngineHandle;
    gain: number;
};

export const setGrandBouleMasterGain = (input: SetGrandBouleMasterGainInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    const clamped = Math.max(0, Math.min(2, input.gain));
    grandBouleStore.set({
        ...state,
        config: { ...state.config, masterGain: clamped },
    });
    input.engine.setParam({ name: 'master_gain', value: clamped });
};

import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule sustain pedal position (CC64).
 *
 * Stores the normalised pedal value and forwards it to the engine so the
 * damper model can update its per-key bandwidth on the next block.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SetGrandBouleSustainInput = {
    engine: GrandBouleEngineHandle;
    position: number;
    store: Store<GrandBouleState>;
};

export const setGrandBouleSustain = (input: SetGrandBouleSustainInput): void => {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    const clamped = Math.max(0, Math.min(1, input.position));
    input.store.set({
        ...state,
        pedals: { ...state.pedals, sustain: clamped },
    });
    input.engine.setSustain({ position: clamped });
};

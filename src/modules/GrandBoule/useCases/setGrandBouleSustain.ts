/**
 * Update the Grand Boule sustain pedal position (CC64).
 *
 * Stores the normalised pedal value and forwards it to the engine so the
 * damper model can update its per-key bandwidth on the next block.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { grandBouleStore } from '../stores/grandBouleStore';

type SetGrandBouleSustainInput = {
    engine: GrandBouleEngineHandle;
    position: number;
};

export const setGrandBouleSustain = (input: SetGrandBouleSustainInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    const clamped = Math.max(0, Math.min(1, input.position));
    grandBouleStore.set({
        ...state,
        pedals: { ...state.pedals, sustain: clamped },
    });
    input.engine.setSustain({ position: clamped });
};

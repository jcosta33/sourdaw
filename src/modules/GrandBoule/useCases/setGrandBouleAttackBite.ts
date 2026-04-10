/**
 * Update the Grand Boule attack-bite (string-precursor) amount.
 *
 * Scales the velocity passed to the longitudinal "string precursor" noise
 * burst that fires alongside `KeyDown` and `HammerLetoff` on every note-on
 * (realism appendix §A6). 0.0 disables the chirp entirely, 1.0 = neutral
 * (full physical model), > 1.0 over-emphasises the bite for samples that
 * need extra presence.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { grandBouleStore } from '../stores/grandBouleStore';

type SetGrandBouleAttackBiteInput = {
    engine: GrandBouleEngineHandle;
    amount: number;
};

export const setGrandBouleAttackBite = (input: SetGrandBouleAttackBiteInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    const clamped = Math.max(0, Math.min(2, input.amount));
    grandBouleStore.set({
        ...state,
        config: { ...state.config, attackBite: clamped },
    });
    input.engine.setParam({ name: 'attack_bite', value: clamped });
};

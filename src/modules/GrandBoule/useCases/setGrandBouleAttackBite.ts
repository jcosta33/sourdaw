import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule attack-bite (string-precursor) amount.
 *
 * Scales the velocity passed to the longitudinal "string precursor" noise
 * burst that fires alongside `KeyDown` and `HammerLetoff` on every note-on.
 * 0.0 disables the chirp; 1.0 keeps the project default
 * (full physical model), > 1.0 over-emphasises the bite for samples that
 * need extra presence.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SetGrandBouleAttackBiteInput = {
    engine: GrandBouleEngineHandle;
    amount: number;
    store: Store<GrandBouleState>;
};

export function setGrandBouleAttackBite(input: SetGrandBouleAttackBiteInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    const clamped = Math.max(0, Math.min(2, input.amount));
    input.store.set({
        ...state,
        config: { ...state.config, attackBite: clamped },
    });
    input.engine.setParam({ name: 'attack_bite', value: clamped });
}

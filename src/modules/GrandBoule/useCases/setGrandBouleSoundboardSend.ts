import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule soundboard send level.
 *
 * 0.0 = dry strings only, 1.0 = fully routed through the parametric
 * soundboard bank (§3.6 Option C).
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SetGrandBouleSoundboardSendInput = {
    engine: GrandBouleEngineHandle;
    amount: number;
    store: Store<GrandBouleState>;
};

export const setGrandBouleSoundboardSend = (input: SetGrandBouleSoundboardSendInput): void => {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    const clamped = Math.max(0, Math.min(1, input.amount));
    input.store.set({
        ...state,
        config: { ...state.config, soundboardSend: clamped },
    });
    input.engine.setParam({ name: 'soundboard_send', value: clamped });
};

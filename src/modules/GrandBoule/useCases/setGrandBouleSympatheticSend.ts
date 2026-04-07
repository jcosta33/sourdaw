/**
 * Update the Grand Boule sympathetic-resonance send level.
 *
 * Drives how much of the bridge bus is fed into the global sympathetic
 * resonator bank (§4.3).
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { grandBouleStore } from '../stores/grandBouleStore';

type SetGrandBouleSympatheticSendInput = {
    engine: GrandBouleEngineHandle;
    amount: number;
};

export const setGrandBouleSympatheticSend = (input: SetGrandBouleSympatheticSendInput): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    const clamped = Math.max(0, Math.min(1, input.amount));
    grandBouleStore.set({
        ...state,
        config: { ...state.config, sympatheticSend: clamped },
    });
    input.engine.setParam({ name: 'sympathetic_send', value: clamped });
};

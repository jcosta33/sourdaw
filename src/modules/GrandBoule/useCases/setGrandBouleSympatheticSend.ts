import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule sympathetic-resonance send level.
 *
 * Drives how much of the bridge bus is fed into the global sympathetic
 * resonator bank.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { dispatchGrandBouleParam } from './grandBouleParamBridge/helpers';

type SetGrandBouleSympatheticSendInput = {
    /** Device id — the address project truth and the undo entry are keyed by. */
    deviceId: string;
    engine: GrandBouleEngineHandle;
    amount: number;
    store: Store<GrandBouleState>;
    /** True while the knob is under the pointer; the commit lands on release. */
    isTransient?: boolean;
};

export function setGrandBouleSympatheticSend(input: SetGrandBouleSympatheticSendInput): void {
    const clamped = Math.max(0, Math.min(1, input.amount));
    dispatchGrandBouleParam({
        deviceId: input.deviceId,
        paramId: 'sympatheticSend',
        value: clamped,
        engine: input.engine,
        store: input.store,
        isTransient: input.isTransient ?? false,
    });
}

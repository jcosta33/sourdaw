import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule soundboard send level.
 *
 * 0.0 = dry strings only, 1.0 = fully routed through the parametric
 * fixed soundboard FIR body.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { dispatchGrandBouleParam } from './grandBouleParamBridge/helpers';

type SetGrandBouleSoundboardSendInput = {
    /** Device id — the address project truth and the undo entry are keyed by. */
    deviceId: string;
    engine: GrandBouleEngineHandle;
    amount: number;
    store: Store<GrandBouleState>;
    /** True while the knob is under the pointer; the commit lands on release. */
    isTransient?: boolean;
};

export function setGrandBouleSoundboardSend(input: SetGrandBouleSoundboardSendInput): void {
    const clamped = Math.max(0, Math.min(1, input.amount));
    dispatchGrandBouleParam({
        deviceId: input.deviceId,
        paramId: 'soundboardSend',
        value: clamped,
        engine: input.engine,
        store: input.store,
        isTransient: input.isTransient ?? false,
    });
}

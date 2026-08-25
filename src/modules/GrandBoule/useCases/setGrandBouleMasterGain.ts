import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule master gain.
 *
 * Writes the new value to the store and forwards it to the engine handle.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { dispatchGrandBouleParam } from './grandBouleParamBridge/helpers';

type SetGrandBouleMasterGainInput = {
    /** Device id — the address project truth and the undo entry are keyed by. */
    deviceId: string;
    engine: GrandBouleEngineHandle;
    gain: number;
    store: Store<GrandBouleState>;
    /** True while the knob is under the pointer; the commit lands on release. */
    isTransient?: boolean;
};

export function setGrandBouleMasterGain(input: SetGrandBouleMasterGainInput): void {
    const clamped = Math.max(0, Math.min(1, input.gain));
    dispatchGrandBouleParam({
        deviceId: input.deviceId,
        paramId: 'masterGain',
        value: clamped,
        engine: input.engine,
        store: input.store,
        isTransient: input.isTransient ?? false,
    });
}

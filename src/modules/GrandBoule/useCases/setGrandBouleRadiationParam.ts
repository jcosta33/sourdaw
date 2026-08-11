import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { dispatchGrandBouleParam } from './grandBouleParamBridge/helpers';

type SetGrandBouleRadiationParamInput = {
    deviceId: string;
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    paramId: 'lidPosition' | 'micPosition';
    value: number;
    isTransient?: boolean;
};

/** Set the audible lid transfer or one of the three microphone perspectives. */
export function setGrandBouleRadiationParam(input: SetGrandBouleRadiationParamInput): void {
    if (!Number.isFinite(input.value)) {
        return;
    }

    let value = Math.max(0, Math.min(1, input.value));
    if (input.paramId === 'micPosition') {
        value = Math.round(Math.max(0, Math.min(2, input.value)));
    }

    dispatchGrandBouleParam({
        deviceId: input.deviceId,
        paramId: input.paramId,
        value,
        engine: input.engine,
        store: input.store,
        isTransient: input.isTransient ?? false,
    });
}

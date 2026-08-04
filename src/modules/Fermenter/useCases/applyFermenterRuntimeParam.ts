import { logger } from '#/infra/logger/appLogger';

import { mapFermenterParamToDspParam } from './fermenterParamBridge/mapFermenterParamToDspParam';
import { FERMENTER_PARAMS } from './fermenterQueries/FERMENTER_PARAMS';
import { getFermenterDependencies } from './getFermenterDependencies';

const FERMENTER_PARAM_IDS = new Set(FERMENTER_PARAMS.map((param) => param.id));

type ApplyFermenterRuntimeParamInput = {
    deviceId: string;
    paramId: string;
    value: number;
};

/**
 * Apply a transient runtime value without changing the user's saved base.
 *
 * Playback automation owns only engine state: it must not update the panel
 * store, enter the UI rAF batch, persist project truth, or create undo and
 * collaboration history. User edits continue to use setFermenterMappedParam.
 */
export function applyFermenterRuntimeParam({ deviceId, paramId, value }: ApplyFermenterRuntimeParamInput): void {
    if (!FERMENTER_PARAM_IDS.has(paramId)) {
        logger.warn(`[Fermenter] Ignored unknown runtime param: ${paramId}`);
        return;
    }

    const { clampDeviceParameterValue, resolveEligibleDeviceWriteTarget, updateDeviceParam } =
        getFermenterDependencies();
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const boundedValue = clampDeviceParameterValue({ deviceType: 'fermenter', paramId, value });
    const dspKey = mapFermenterParamToDspParam({ paramId });
    updateDeviceParam(target.trackId, target.deviceId, dspKey, boundedValue);
}

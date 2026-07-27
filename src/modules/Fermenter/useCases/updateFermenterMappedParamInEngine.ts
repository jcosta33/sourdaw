import { logger } from '#/infra/logger/appLogger';

import { mapFermenterParamToDspParam } from './fermenterParamBridge/mapFermenterParamToDspParam';
import { FERMENTER_PARAMS } from './fermenterQueries/FERMENTER_PARAMS';
import { getFermenterDependencies } from './getFermenterDependencies';

const FERMENTER_PARAM_IDS = new Set(FERMENTER_PARAMS.map((param) => param.id));

type UpdateFermenterMappedParamInEngineInput = {
    deviceId: string;
    paramId: string;
    value: number;
};

export function updateFermenterMappedParamInEngine({
    deviceId,
    paramId,
    value,
}: UpdateFermenterMappedParamInEngineInput): void {
    if (!FERMENTER_PARAM_IDS.has(paramId)) {
        logger.warn(`[Fermenter] Ignored unknown runtime param: ${paramId}`);
        return;
    }

    const dependencies = getFermenterDependencies();
    const target = dependencies.resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const dspParamId = mapFermenterParamToDspParam({ paramId });
    dependencies.updateDeviceParam(target.trackId, target.deviceId, dspParamId, value);
}

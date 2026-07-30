import { logger } from '#/infra/logger/appLogger';

import { mapFermenterParamToDspParam } from './fermenterParamBridge/mapFermenterParamToDspParam';
import { isFermenterParamId } from './fermenterQueries/isFermenterParamId';
import { getFermenterDependencies } from './getFermenterDependencies';

type ApplyFermenterRuntimeParamInput = {
    trackId: string;
    deviceId: string;
    paramId: string;
    value: number;
};

/** Write an already-authorized, descriptor-bounded value to the live Fermenter DSP only. */
export function applyFermenterRuntimeParam({
    trackId,
    deviceId,
    paramId,
    value,
}: ApplyFermenterRuntimeParamInput): void {
    if (!isFermenterParamId(paramId)) {
        logger.warn(`[Fermenter] Ignored unknown runtime param: ${paramId}`);
        return;
    }

    const { updateDeviceParam } = getFermenterDependencies();
    const dspParamId = mapFermenterParamToDspParam({ paramId });
    updateDeviceParam(trackId, deviceId, dspParamId, value);
}

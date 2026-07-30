import { logger } from '#/infra/logger/appLogger';

import { setFermenterParamWithAudio } from './fermenterParamBridge/setFermenterParamWithAudio';
import { isFermenterParamId } from './fermenterQueries/isFermenterParamId';

type SetFermenterMappedParamInput = {
    deviceId: string;
    paramId: string;
    value: number;
};

export function setFermenterMappedParam({ deviceId, paramId, value }: SetFermenterMappedParamInput): void {
    if (!isFermenterParamId(paramId)) {
        logger.warn(`[Fermenter] Ignored unknown mapped param: ${paramId}`);
        return;
    }

    setFermenterParamWithAudio(deviceId, paramId, value);
}

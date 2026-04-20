import { logger } from '#/infra/logger/appLogger';

import { type FermenterPatch } from '../models/FermenterPatch';

import { setFermenterParamWithAudio } from './fermenterParamBridge/setFermenterParamWithAudio';
import { FERMENTER_PARAMS } from './fermenterQueries/FERMENTER_PARAMS';

const FERMENTER_PARAM_IDS = new Set(FERMENTER_PARAMS.map((param) => param.id));

type SetFermenterMappedParamInput = {
    deviceId: string;
    paramId: string;
    value: number;
};

export function setFermenterMappedParam({ deviceId, paramId, value }: SetFermenterMappedParamInput): void {
    if (!FERMENTER_PARAM_IDS.has(paramId)) {
        logger.warn(`[Fermenter] Ignored unknown mapped param: ${paramId}`);
        return;
    }

    setFermenterParamWithAudio(deviceId, paramId as keyof FermenterPatch, value);
}

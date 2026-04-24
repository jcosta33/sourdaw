import { type LevainPatch } from '../../models/LevainPatch';

import { levainBridge } from './levainBridge';

export const setLevainParamWithAudio = <K extends keyof LevainPatch>(deviceId: string, key: K, value: LevainPatch[K]): void => {
    levainBridge().setLevainParamWithAudio(deviceId, key, value);
};

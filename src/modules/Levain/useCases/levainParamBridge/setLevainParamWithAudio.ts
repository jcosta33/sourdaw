import { type LevainPatch } from '../../models/LevainPatch';

import { levainBridge } from './levainBridge';

export const setLevainParamWithAudio = <TKey extends keyof LevainPatch>(
    deviceId: string,
    key: TKey,
    value: LevainPatch[TKey]
): void => {
    levainBridge().setLevainParamWithAudio(deviceId, key, value);
};

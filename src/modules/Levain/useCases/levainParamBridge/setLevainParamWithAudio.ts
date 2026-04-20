import { type LevainPatch } from '../../models/LevainPatch';

import { levainBridge } from './levainBridge';

export const setLevainParamWithAudio = <K extends keyof LevainPatch>(key: K, value: LevainPatch[K]): void => {
    levainBridge().setLevainParamWithAudio(key, value);
};

import { type LevainPatch } from '../../models/LevainPatch';

import { levainBridge } from './levainBridge';

export const applyPatchToEngine = (deviceId: string, patch: LevainPatch): void => {
    levainBridge().applyPatchToEngine(deviceId, patch);
};

import { type LevainPatch } from '../../models/LevainPatch';

import { levainBridge } from './levainBridge';

export function setLevainParamWithAudio<PatchKey extends keyof LevainPatch>(
    key: PatchKey,
    value: LevainPatch[PatchKey]
): void {
    levainBridge().setLevainParamWithAudio(key, value);
}

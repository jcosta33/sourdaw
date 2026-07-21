import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type FermenterPatch } from '../../models/FermenterPatch';
import { setFermenterParam } from '../../stores/fermenterStore';
import { getFermenterDependencies } from '../getFermenterDependencies';

import { mapFermenterParamToDspParam } from './mapFermenterParamToDspParam';

// §33.2 — Shared rAF-batch primitive.
type FermenterBatchEntry = { deviceId: string; dspKey: string; key: string; value: number };
const paramBatcher = createRafBatcher<FermenterBatchEntry>();

function flushParam(_compositeKey: string, entry: FermenterBatchEntry): void {
    const { updateDeviceParam, persistDeviceParam, resolveEligibleDeviceWriteTarget } = getFermenterDependencies();
    const target = resolveEligibleDeviceWriteTarget(entry.deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    updateDeviceParam(target.trackId, target.deviceId, entry.dspKey, entry.value);
    persistDeviceParam(target.deviceId, entry.key, entry.value);
}

/**
 * Set a Fermenter parameter — updates the UI store immediately,
 * and throttles audio engine updates to once per animation frame.
 */
export function setFermenterParamWithAudio(deviceId: string, key: keyof FermenterPatch, value: number): void {
    const target = getFermenterDependencies().resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    setFermenterParam(deviceId, key, value);

    const compositeKey = `${deviceId}:${key}`;
    const dspKey = mapFermenterParamToDspParam({ paramId: key });
    paramBatcher.schedule(compositeKey, { deviceId: target.deviceId, dspKey, key, value }, flushParam);
}

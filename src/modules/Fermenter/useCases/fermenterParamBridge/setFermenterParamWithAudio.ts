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

    // `entry.value` was already resolved against the declared range in
    // `setFermenterParamWithAudio`, on the camelCase key the descriptor
    // declares. Both writes send that one number: the engine cannot re-resolve
    // it, because the DSP key it receives matches no descriptor entry.
    updateDeviceParam(target.trackId, target.deviceId, entry.dspKey, entry.value);
    persistDeviceParam(target.deviceId, entry.key, entry.value);
}

/**
 * Set a Fermenter parameter — updates the UI store immediately,
 * and throttles audio engine updates to once per animation frame.
 */
export function setFermenterParamWithAudio(deviceId: string, key: keyof FermenterPatch, value: number): void {
    const { resolveEligibleDeviceWriteTarget, clampDeviceParameterValue } = getFermenterDependencies();
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    // Resolved once, here, before the key is mapped — the panel store, the
    // track store and the DSP then all hold the same number. Resolving it
    // downstream instead would clamp only the two writes that still carry the
    // camelCase key and leave the engine, which gets the DSP key, unbounded.
    const boundedValue = clampDeviceParameterValue({ deviceType: 'fermenter', paramId: key, value });

    setFermenterParam(deviceId, key, boundedValue);

    const compositeKey = `${deviceId}:${key}`;
    const dspKey = mapFermenterParamToDspParam({ paramId: key });
    paramBatcher.schedule(compositeKey, { deviceId: target.deviceId, dspKey, key, value: boundedValue }, flushParam);
}

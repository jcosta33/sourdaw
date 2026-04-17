import { type FermenterPatch } from '../../models/FermenterPatch';
import { setFermenterParam } from '../../stores/fermenterStore';
import { getFermenterDependencies } from '../fermenterDependencies';
import { createRafBatcher } from '#/utils/DOM/createRafBatcher';
import type { DeviceRef } from './helpers';
import { createFindDeviceRef } from './helpers';

// §33.2 — Shared rAF-batch primitive.
type FermenterBatchEntry = { ref: DeviceRef; key: string; value: number };
const paramBatcher = createRafBatcher<FermenterBatchEntry>();

let findDeviceRef: ReturnType<typeof createFindDeviceRef> | null = null;

function getFindDeviceRef() {
    if (!findDeviceRef) {
        findDeviceRef = createFindDeviceRef(getFermenterDependencies().getAllTracks);
    }
    return findDeviceRef;
}

function flushParam(_compositeKey: string, entry: FermenterBatchEntry): void {
    const { updateDeviceParam, persistDeviceParam } = getFermenterDependencies();
    updateDeviceParam(entry.ref.trackId, entry.ref.deviceId, entry.key, entry.value);
    persistDeviceParam(entry.ref.deviceId, entry.key, entry.value);
}

/**
 * Set a Fermenter parameter — updates the UI store immediately,
 * and throttles audio engine updates to once per animation frame.
 */
export function setFermenterParamWithAudio(deviceId: string, key: keyof FermenterPatch, value: number): void {
    setFermenterParam(deviceId, key, value);

    const ref = getFindDeviceRef()(deviceId);
    if (!ref) {
        return;
    }

    const compositeKey = `${deviceId}:${key}`;
    paramBatcher.schedule(compositeKey, { ref, key, value }, flushParam);
}
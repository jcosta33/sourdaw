import { type FermenterPatch } from '../../models/FermenterPatch';
import { fermenterStore, getFermenterState } from '../../stores/fermenterStore';
import { hydrateFermenterFromProject } from '../hydrateFermenterFromProject';
import { getFermenterDependencies } from '../getFermenterDependencies';

import { loadFermenterPatchWithAudio } from './loadFermenterPatchWithAudio';

/** Resolve the descriptor's scalar law before joining the device's frame write. */
export function setFermenterParamWithAudio(deviceId: string, key: keyof FermenterPatch, value: number): void {
    if (!Number.isFinite(value)) {
        return;
    }
    const { clampDeviceParameterValue } = getFermenterDependencies();
    const boundedValue = clampDeviceParameterValue({ deviceType: 'fermenter', paramId: key, value });
    const patch =
        fermenterStore.value?.[deviceId]?.patch ??
        hydrateFermenterFromProject(deviceId) ??
        getFermenterState(deviceId).patch;
    loadFermenterPatchWithAudio(deviceId, { ...patch, [key]: boundedValue });
}

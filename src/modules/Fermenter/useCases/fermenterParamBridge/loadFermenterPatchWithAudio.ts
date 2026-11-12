import { cloneFermenterPatch } from '../../models/FermenterPatchState';
import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { prepareFermenterPatchWrite } from '../prepareFermenterPatchWrite';

import { fermenterPatchBatcher } from './fermenterParamBatcher';

/** Optimistic panel feedback; the last edit in a frame commits through Command. */
export function loadFermenterPatchWithAudio(deviceId: string, patch: FermenterPatch): void {
    const write = prepareFermenterPatchWrite({ deviceId, patch, label: 'Change Fermenter patch', continuous: true });
    if (!write) {
        return;
    }
    loadFermenterPatch(deviceId, cloneFermenterPatch(write.patch));
    fermenterPatchBatcher.schedule(deviceId, write);
}

import { DEFAULT_PATCH } from '../../models/FermenterPatch';

import { fermenterParamBatcher, fermenterPatchBatcher } from './fermenterParamBatcher';

/** A committed whole patch supersedes only this instance's older frame writes. */
export function cancelPendingFermenterPatchWrites(deviceId: string): void {
    fermenterPatchBatcher.cancel(deviceId);
    for (const key of Object.keys(DEFAULT_PATCH)) {
        fermenterParamBatcher.cancel(`${deviceId}:${key}`);
    }
}

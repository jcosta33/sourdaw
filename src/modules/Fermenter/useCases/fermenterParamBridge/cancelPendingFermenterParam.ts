import { type FermenterPatch } from '../../models/FermenterPatch';

import { fermenterPatchBatcher } from './fermenterParamBatcher';

export function cancelPendingFermenterParam(deviceId: string, key: keyof FermenterPatch): void {
    fermenterPatchBatcher.cancelParameter(deviceId, key);
}

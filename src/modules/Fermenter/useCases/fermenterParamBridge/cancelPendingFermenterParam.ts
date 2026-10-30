import { type FermenterPatch } from '../../models/FermenterPatch';

import { fermenterParamBatcher } from './fermenterParamBatcher';

export function cancelPendingFermenterParam(deviceId: string, key: keyof FermenterPatch): void {
    fermenterParamBatcher.cancel(`${deviceId}:${key}`);
}

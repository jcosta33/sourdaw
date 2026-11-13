import { fermenterPatchBatcher } from './fermenterParamBatcher';

export function cancelPendingFermenterPatchWrites(deviceId: string): void {
    fermenterPatchBatcher.cancel(deviceId);
}

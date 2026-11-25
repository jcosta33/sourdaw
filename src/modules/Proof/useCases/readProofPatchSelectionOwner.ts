import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getPlannedDevicePatchState } from '#/modules/Arrangement/useCases';

export function readProofPatchSelectionOwner(deviceId: string, parameterIds: readonly string[]) {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return null;
    }
    const owner = getPlannedDevicePatchState({ trackId: target.trackId, deviceId, parameterIds });
    return owner?.deviceType === 'proof' && !owner.frozen ? owner : null;
}

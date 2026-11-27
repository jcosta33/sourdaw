import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getDevicePatchOwnerIncarnation, getPlannedDevicePatchState } from '#/modules/Arrangement/useCases';

import { getRectifierHeavyPresetImage } from './getRectifierHeavyPresetImage';

/** Capture a projection witness; the eventual command must validate document authority before committing. */
export function captureRectifierHeavyPreset(deviceId: string) {
    const image = getRectifierHeavyPresetImage();
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (!image || target.status !== 'eligible') {
        return null;
    }
    const parameterIds = Object.keys(image.parameterValues);
    const owner = getPlannedDevicePatchState({ trackId: target.trackId, deviceId, parameterIds });
    if (!owner || owner.deviceType !== 'grinder' || owner.frozen) {
        return null;
    }
    const ownerIncarnation = getDevicePatchOwnerIncarnation({ trackId: owner.trackId, deviceId });
    if (!ownerIncarnation) {
        return null;
    }
    return {
        trackId: owner.trackId,
        deviceId,
        deviceIds: owner.deviceIds,
        ownerIncarnation,
        parameterIds,
        patch: image.patch,
        before: owner.state,
        after: { deviceState: owner.state.deviceState, parameterValues: image.parameterValues },
    };
}

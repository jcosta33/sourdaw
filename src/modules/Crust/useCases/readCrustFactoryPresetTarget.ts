import { getObjectId } from '@automerge/automerge';

import { resolveEligibleDeviceWriteTarget, type Track } from '#/modules/Arrangement/stores';
import { getPlannedDevicePatchState } from '#/modules/Arrangement/useCases';
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { CRUST_PRESET_PARAMETER_ORDER } from '../models/CrustPresetParameterOrder';

export function readCrustFactoryPresetTarget(deviceId: string) {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return null;
    }
    const owner = getPlannedDevicePatchState({
        trackId: target.trackId,
        deviceId,
        parameterIds: CRUST_PRESET_PARAMETER_ORDER,
    });
    if (owner?.deviceType !== 'crust' || owner.frozen) {
        return null;
    }

    const tracks = getCrdtDoc<{ tracks?: { tracks?: Track[] } }>('root')?.tracks?.tracks;
    if (!Array.isArray(tracks)) {
        return null;
    }
    const track = tracks.find((candidate) => candidate?.id === target.trackId);
    const device = Array.isArray(track?.devices)
        ? track.devices.find((candidate) => candidate?.id === deviceId)
        : undefined;
    if (!track || device?.type !== 'crust') {
        return null;
    }
    const trackObjectId = getObjectId(track);
    const deviceObjectId = getObjectId(device);
    return trackObjectId && deviceObjectId ? { ...owner, trackObjectId, deviceObjectId } : null;
}

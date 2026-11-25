import { getObjectId } from '@automerge/automerge';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getPlannedDevicePatchState } from '#/modules/Arrangement/useCases';
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { isRecord } from '#/utils/structuralEquality';

import { CRUST_PRESET_PARAMETER_ORDER } from '../models/CrustPresetParameterOrder';

function readCrustOwnerIdentities(trackId: string, deviceId: string) {
    const tracks = getCrdtDoc<{ tracks?: { tracks?: unknown } }>('root')?.tracks?.tracks;
    if (!Array.isArray(tracks)) {
        return null;
    }
    const track: unknown = tracks.find((candidate: unknown) => isRecord(candidate) && candidate.id === trackId);
    if (!isRecord(track) || !Array.isArray(track.devices)) {
        return null;
    }
    const device: unknown = track.devices.find(
        (candidate: unknown) => isRecord(candidate) && candidate.id === deviceId
    );
    if (!isRecord(device) || device.type !== 'crust') {
        return null;
    }
    const trackObjectId = getObjectId(track);
    const deviceObjectId = getObjectId(device);
    return trackObjectId && deviceObjectId ? { trackObjectId, deviceObjectId } : null;
}

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
    const identities = readCrustOwnerIdentities(target.trackId, deviceId);
    return identities ? { ...owner, ...identities } : null;
}

import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { readToasterMasterGainState } from '../models/ToasterMasterGainPatch';

export function getToasterMasterGainTarget(deviceId: string) {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return null;
    }
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === target.trackId);
    const device = track?.devices.find((candidate) => candidate.id === deviceId);
    if (!track || track.frozen === true || device?.type !== DEVICE_TYPE_IDS.toaster) {
        return null;
    }
    if (Object.hasOwn(device, 'deviceState') && !device.deviceState) {
        return null;
    }
    const current = readToasterMasterGainState(device.deviceState ?? null);
    if (!current) {
        return null;
    }
    return { trackId: track.id, deviceIds: track.devices.map(({ id }) => id), current };
}

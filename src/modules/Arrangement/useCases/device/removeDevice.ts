import { removeDeviceFromStrip } from '#/modules/AudioEngine/useCases';
import { unloadPlugin } from '#/modules/Plugin/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function removeDevice(deviceId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const device = track.devices.find((data) => data.id === deviceId);
        if (device) {
            removeDeviceFromStrip(track.id, deviceId);
            if (device.type === 'external-plugin' && device.externalInstanceId) {
                void unloadPlugin(device.externalInstanceId);
            }
            break;
        }
    }

    mapAllTracks((time) => ({ ...time, devices: time.devices.filter((data) => data.id !== deviceId) }));
}

import { removeDeviceFromStrip, removeTrackStrip } from '#/modules/AudioEngine/useCases';
import { unloadPlugin } from '#/modules/PluginHost/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';

export function removeDevice(deviceId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const device = track.devices.find((data) => data.id === deviceId);
        if (device) {
            const retainsToaster = track.devices.some(
                (candidate) => candidate.id !== deviceId && candidate.type === 'toaster'
            );
            const shouldRemoveTrackStrip =
                device.type === 'toaster' &&
                track.kind === 'folder' &&
                shouldCreateLiveTrackStrip(track) &&
                !retainsToaster;
            removeDeviceFromStrip(track.id, deviceId);
            if (shouldRemoveTrackStrip) {
                removeTrackStrip(track.id);
            }
            if (device.type === 'external-plugin' && device.externalInstanceId) {
                void unloadPlugin(device.externalInstanceId);
            }
            break;
        }
    }

    mapAllTracks((time) => ({ ...time, devices: time.devices.filter((data) => data.id !== deviceId) }));
}

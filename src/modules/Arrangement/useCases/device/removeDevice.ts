import { inject } from '#/infra/di/inject';
import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { removeDeviceFromStrip } from '#/modules/AudioEngine/useCases/deviceControls';
import { unloadPlugin } from '#/modules/Plugin/useCases/pluginLifecycle';

export const removeDevice = inject({ getTrackState, mapAllTracks })(
    ({ getTrackState, mapAllTracks }) =>
        function removeDevice(deviceId: string): void {
            const state = getTrackState();
            if (!state) {
                return;
            }

            for (const track of state.tracks) {
                const device = track.devices.find((d) => d.id === deviceId);
                if (device) {
                    removeDeviceFromStrip(track.id, deviceId);
                    if (device.type === 'external-plugin' && device.externalInstanceId) {
                        unloadPlugin(device.externalInstanceId);
                    }
                    break;
                }
            }

            mapAllTracks((t) => ({ ...t, devices: t.devices.filter((d) => d.id !== deviceId) }));
        }
);

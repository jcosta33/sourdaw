import { inject } from '#/infra/di/inject';
import { addDeviceToStrip } from '#/modules/AudioEngine';
import { loadPlugin } from '#/modules/Plugin';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { type Device } from '../../stores/trackStore';

function nextDeviceIdStr(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

export const addExternalDevice = inject({ getTrackState, updateTrack })(
    ({ getTrackState, updateTrack }) =>
        function addExternalDevice(trackId: string, pluginId: string, pluginName: string): Device | null {
            const state = getTrackState();
            if (!state) {
                return null;
            }

            const instanceId = `${pluginId}-${String(Date.now())}`;

            const device: Device = {
                id: nextDeviceIdStr(),
                name: pluginName,
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: pluginId,
                externalInstanceId: instanceId,
            };

            updateTrack(trackId, (t) => ({ ...t, devices: [...t.devices, device] }));

            addDeviceToStrip(trackId, device.id, 'external-plugin', instanceId);
            loadPlugin(pluginId, instanceId);

            return device;
        }
);

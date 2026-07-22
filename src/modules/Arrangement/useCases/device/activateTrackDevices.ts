import { addDeviceToStrip, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { compileFaustDSP, loadPlugin } from '#/modules/PluginHost/useCases';

import { type Device } from '../../stores/trackStore';

type ActivateTrackDevicesInput = {
    trackId: string;
    devices: readonly Device[];
};

export function activateTrackDevices({ trackId, devices }: ActivateTrackDevicesInput): void {
    for (const device of devices) {
        if (device.type.startsWith('faust-')) {
            Promise.resolve()
                .then(() => compileFaustDSP(device.type))
                .catch(() => {
                    // Faust compilation is best-effort — device falls back to passthrough
                });
        }

        if (device.externalInstanceId) {
            addDeviceToStrip(trackId, device.id, device.type, device.externalInstanceId);
        } else {
            addDeviceToStrip(trackId, device.id, device.type);
        }

        for (const [paramId, value] of Object.entries(device.parameterValues)) {
            updateDeviceParam(trackId, device.id, paramId, value);
        }

        if (device.type === 'external-plugin' && device.externalPluginId && device.externalInstanceId) {
            void loadPlugin(device.externalPluginId, device.externalInstanceId);
        }
    }
}

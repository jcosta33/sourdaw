import { getTrackState, updateTrack } from '../../repositories/trackRepository';
import { type Device } from '../../models/Track';
import { addDeviceToStrip } from '#/modules/AudioEngine/useCases/deviceControls';
import { loadPlugin } from '#/modules/Plugin/useCases/pluginLifecycleUseCases';

function nextDeviceIdStr(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

export function addExternalDevice(trackId: string, pluginId: string, pluginName: string): Device | null {
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
    void loadPlugin(pluginId, instanceId);

    return device;
}

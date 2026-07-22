import { addDeviceToStrip } from '#/modules/AudioEngine/useCases';
import { loadPlugin } from '#/modules/PluginHost/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { type Device } from '../../stores/trackStore';

function nextDeviceIdStr(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

export function addExternalDevice(trackId: string, pluginId: string, pluginName: string): Device | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }
    const track = state.tracks.find((candidate) => candidate.id === trackId);
    if (!track || !getTrackEligibility(track.kind).acceptsDeviceAdd) {
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

    const projectedTrack = { ...track, devices: [...track.devices, device] };
    updateTrack(trackId, (time) => ({ ...time, devices: [...time.devices, device] }));

    if (shouldCreateLiveTrackStrip(projectedTrack)) {
        addDeviceToStrip(trackId, device.id, 'external-plugin', instanceId);
        void loadPlugin(pluginId, instanceId);
    }

    return device;
}

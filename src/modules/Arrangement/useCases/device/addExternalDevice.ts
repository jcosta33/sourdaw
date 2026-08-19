import { findSupportedPlugin } from '#/modules/PluginHost/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { type Device } from '../../stores/trackStore';

function nextDeviceIdStr(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

export function addExternalDevice(trackId: string, pluginId: string, pluginName: string): Device | null {
    if (!findSupportedPlugin(pluginId)) {
        return null;
    }

    const state = getTrackState();
    if (!state) {
        return null;
    }
    const matchingTracks = state.tracks.filter((candidate) => candidate.id === trackId);
    if (matchingTracks.length !== 1) {
        return null;
    }
    const track = matchingTracks[0];
    if (!track || !getTrackEligibility(track.kind).acceptsDeviceAdd) {
        return null;
    }

    const instanceId = `${pluginId}-${crypto.randomUUID()}`;

    const device: Device = {
        id: nextDeviceIdStr(),
        name: pluginName,
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalPluginId: pluginId,
        externalInstanceId: instanceId,
    };

    updateTrack(trackId, () => ({ ...track, devices: [...track.devices, device] }));

    return device;
}

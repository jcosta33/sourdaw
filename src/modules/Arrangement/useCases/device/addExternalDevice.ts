import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { type Device } from '../../stores/trackStore';

import { activateTrackDevices } from './activateTrackDevices';

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

    const hadLiveStrip = shouldCreateLiveTrackStrip(track);
    const projectedTrack = { ...track, devices: [...track.devices, device] };
    updateTrack(trackId, (time) => ({ ...time, devices: [...time.devices, device] }));

    if (shouldCreateLiveTrackStrip(projectedTrack)) {
        const devicesToActivate = hadLiveStrip ? [device] : projectedTrack.devices;
        activateTrackDevices({ trackId, devices: devicesToActivate });
    }

    return device;
}

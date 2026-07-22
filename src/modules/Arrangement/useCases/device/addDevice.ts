import { addDeviceToStrip, updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { compileFaustDSP } from '#/modules/PluginHost/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';
import { type Device } from '../../stores/trackStore';
import { getPlatformPlugins } from '../getPlatformPlugins';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';

function nextDeviceIdStr(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

export function addDevice(trackId: string, deviceType: string): Device | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }
    const track = state.tracks.find((candidate) => candidate.id === trackId);
    if (!track || !getTrackEligibility(track.kind).acceptsDeviceAdd) {
        return null;
    }

    if (deviceType.toLowerCase() === 'crust') {
        notifyUser('PluginNotImplementedError: Crust is not fully implemented', 'error');
        return null;
    }

    // Search by name first, then by ID — callers may pass either
    const plugin = getPlatformPlugins().find(
        (param1) => param1.name.toLowerCase() === deviceType.toLowerCase() || param1.id === deviceType
    );
    const parameterValues: Record<string, number> = {};
    if (plugin) {
        for (const param of plugin.parameters) {
            parameterValues[param.id] = param.value;
        }
    }

    const device: Device = {
        id: nextDeviceIdStr(),
        name: plugin ? plugin.name : deviceType,
        type: plugin ? plugin.id : deviceType,
        bypassed: false,
        parameterValues,
    };

    const hadLiveStrip = shouldCreateLiveTrackStrip(track);
    const activatesFolderStrip = !hadLiveStrip && track.kind === 'folder' && device.type === 'toaster';
    updateTrack(trackId, (time) => ({ ...time, devices: [...time.devices, device] }));

    if (!plugin) {
        return device;
    }

    if (activatesFolderStrip) {
        projectTrackToLiveStrip({ trackId });
        return device;
    }

    if (hadLiveStrip) {
        if (plugin.id.startsWith('faust-')) {
            Promise.resolve()
                .then(() => compileFaustDSP(plugin.id))
                .catch(() => {
                    // Faust compilation is best-effort — device falls back to passthrough
                });
        }
        addDeviceToStrip(trackId, device.id, plugin.id);
        for (const param of plugin.parameters) {
            updateDeviceParam(trackId, device.id, param.id, param.value);
        }
    }

    return device;
}

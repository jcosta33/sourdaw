import { notifyUser } from '#/utils/Notification/notifyUser';

import { isDeviceSupportedOnCurrentPlatform } from '../../models/DeviceParameter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { type Device } from '../../stores/trackStore';
import { getPlatformPlugins } from '../getPlatformPlugins';

function nextDeviceId(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

/** Internal project writer for registered Arrangement handlers. It has no runtime effects. */
export function writeDeviceToProject(
    trackId: string,
    deviceType: string,
    displayName?: string,
    deviceId?: string,
    deviceIndex?: number,
    initialInternalParameterValues?: Readonly<Record<string, number>>
): Device | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }
    const matchingTracks = state.tracks.filter((candidate) => candidate.id === trackId);
    if (matchingTracks.length !== 1) {
        return null;
    }
    const resolvedDeviceId = deviceId ?? nextDeviceId();
    if (state.tracks.some((candidate) => candidate.devices.some((device) => device.id === resolvedDeviceId))) {
        return null;
    }
    const track = matchingTracks[0];
    if (!track || !getTrackEligibility(track.kind).acceptsDeviceAdd) {
        return null;
    }
    const insertionIndex = deviceIndex ?? track.devices.length;
    if (!Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > track.devices.length) {
        return null;
    }
    if (!isDeviceSupportedOnCurrentPlatform(deviceType)) {
        notifyUser(`"${deviceType}" is not available and was not added.`, 'error');
        return null;
    }
    const plugin = getPlatformPlugins().find(
        (candidate) => candidate.name.toLowerCase() === deviceType.toLowerCase() || candidate.id === deviceType
    );
    const internalParameterValues = initialInternalParameterValues ?? plugin?.internalParameterValues ?? {};
    const parameterValues: Record<string, number> = { ...internalParameterValues };
    if (plugin) {
        for (const parameter of plugin.parameters) {
            parameterValues[parameter.id] = parameter.value;
        }
    }
    const device: Device = {
        id: resolvedDeviceId,
        name: displayName ?? (plugin ? plugin.name : deviceType),
        type: plugin ? plugin.id : deviceType,
        bypassed: false,
        parameterValues,
    };
    const afterTrack = {
        ...track,
        devices: [...track.devices.slice(0, insertionIndex), device, ...track.devices.slice(insertionIndex)],
    };
    updateTrack(trackId, () => afterTrack);
    return device;
}

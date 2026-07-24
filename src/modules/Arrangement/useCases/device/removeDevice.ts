import { logger } from '#/infra/logger/appLogger';
import { clearReportedLatency, removeDeviceFromStrip, removeTrackStrip } from '#/modules/AudioEngine/useCases';
import { unloadPlugin } from '#/modules/PluginHost/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../../stores/trackEligibility';

import type { Device, Track } from '../../models/Track';

type RemoveDeviceOutcome = 'written' | 'missing' | 'conflict';

export function removeDevice(deviceId: string): RemoveDeviceOutcome {
    const state = getTrackState();
    if (!state) {
        return 'missing';
    }

    let target: { track: Track; device: Device } | null = null;
    for (const track of state.tracks) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }
            if (target) {
                return 'conflict';
            }
            target = { track, device };
        }
    }
    if (!target) {
        return 'missing';
    }

    const { track, device } = target;
    const matchingOwners = state.tracks.filter((candidate) => candidate.id === track.id);
    if (matchingOwners.length !== 1) {
        return 'conflict';
    }

    const remainingDevices = track.devices.filter((candidate) => candidate.id !== deviceId);
    const trackEligibility = getTrackEligibility(track.kind);
    const wasLive = shouldCreateLiveTrackStrip(track);
    const remainsLive =
        trackEligibility.createsLiveStrip ||
        (track.kind === 'folder' && remainingDevices.some((candidate) => candidate.type === 'toaster'));
    const deactivatesStrip = wasLive && !remainsLive;
    const shouldUnloadRemovedExternal = wasLive || !trackEligibility.acceptsDeviceUpdate;
    const externalInstanceIds = new Set<string>();
    if (deactivatesStrip) {
        for (const retainedDevice of remainingDevices) {
            if (retainedDevice.type === 'external-plugin' && retainedDevice.externalInstanceId) {
                externalInstanceIds.add(retainedDevice.externalInstanceId);
            }
        }
    }
    if (device.type === 'external-plugin' && device.externalInstanceId && shouldUnloadRemovedExternal) {
        externalInstanceIds.add(device.externalInstanceId);
    }

    mapAllTracks((candidate) => {
        if (candidate.id !== track.id) {
            return candidate;
        }
        return { ...candidate, devices: candidate.devices.filter((item) => item.id !== deviceId) };
    });

    try {
        removeDeviceFromStrip(track.id, deviceId);
    } catch (error) {
        logger.warn(`Failed to remove device ${deviceId} from track strip ${track.id}: ${String(error)}`);
    }

    if (device.type === 'external-plugin') {
        // Drop this device's reported-latency entry (PH-4) so the registry does
        // not retain stale latency for a removed native plugin. Keyed by the
        // engine device id, matching how it was reported at activation.
        clearReportedLatency(deviceId);
    }

    if (deactivatesStrip) {
        try {
            removeTrackStrip(track.id);
        } catch (error) {
            logger.warn(`Failed to remove track strip ${track.id}: ${String(error)}`);
        }
    }

    for (const instanceId of externalInstanceIds) {
        try {
            void unloadPlugin(instanceId).catch((error: unknown) => {
                logger.warn(`Failed to unload external plugin instance ${instanceId}: ${String(error)}`);
            });
        } catch (error) {
            logger.warn(`Failed to unload external plugin instance ${instanceId}: ${String(error)}`);
        }
    }
    return 'written';
}

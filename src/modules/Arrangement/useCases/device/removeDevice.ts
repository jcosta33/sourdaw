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
    // Every external-plugin device whose native instance this removal tears down,
    // keyed by engine device id — the same key the latency registry uses — so the
    // unload set and the registry-clear set cannot drift apart. Deactivating the
    // strip unloads the retained siblings too, and their reported latency has to
    // go with them.
    const unloadedExternalDevices = new Map<string, string>();
    if (deactivatesStrip) {
        for (const retainedDevice of remainingDevices) {
            if (retainedDevice.type === 'external-plugin' && retainedDevice.externalInstanceId) {
                unloadedExternalDevices.set(retainedDevice.id, retainedDevice.externalInstanceId);
            }
        }
    }
    if (device.type === 'external-plugin' && device.externalInstanceId && shouldUnloadRemovedExternal) {
        unloadedExternalDevices.set(device.id, device.externalInstanceId);
    }
    const externalInstanceIds = new Set<string>(unloadedExternalDevices.values());

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

    // Drop reported-latency entries (PH-4) so the registry keeps no phantom
    // compensation: getDeviceLatencyMs reads it unconditionally and getTrackLatency
    // sums it, so a surviving entry inflates the whole track's delay forever.
    //
    // Two reasons an entry must go: the removed device leaves the chain even when
    // its instance stays loaded, and every sibling whose instance this removal
    // unloads stops processing audio. One set, so an entry that qualifies on both
    // counts is still cleared exactly once.
    const latencyDeviceIdsToClear = new Set<string>(unloadedExternalDevices.keys());
    if (device.type === 'external-plugin') {
        latencyDeviceIdsToClear.add(deviceId);
    }
    for (const clearedDeviceId of latencyDeviceIdsToClear) {
        clearReportedLatency(clearedDeviceId);
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

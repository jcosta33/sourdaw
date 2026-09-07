import { clearExternalPluginRestoreFailure } from '#/modules/PluginHost/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

import type { Track } from '../../models/Track';

type Device = Track['devices'][number];

function findDeviceById(tracks: readonly Track[], deviceId: string): Device | undefined {
    for (const track of tracks) {
        const device = track.devices.find((candidate) => candidate.id === deviceId);
        if (device) {
            return device;
        }
    }
    return undefined;
}

/**
 * Persist a native plugin's opaque state chunk (base64) onto its device in
 * project truth. The authoritative mutation behind the `setExternalPluginState`
 * action: dispatched from the save flow so the chunk rides the CRDT write path
 * and is restored on the next load.
 *
 * A write here is a deliberate replacement: whatever a failed state restore
 * marked about the instance no longer holds, because project truth now carries
 * state that was chosen on purpose. The marker is cleared here — in the use
 * case that owns the mutation — so capture reads the host again on the next
 * save.
 *
 * Returns false when no device carries the id, so the handler reports a
 * no-write and the CRDT transaction aborts instead of committing an empty diff.
 */
export function setExternalPluginState(deviceId: string, stateChunk: string): boolean {
    const state = getTrackState();
    if (!state) {
        return false;
    }

    const device = findDeviceById(state.tracks, deviceId);
    if (!device) {
        return false;
    }

    mapAllTracks((track) => ({
        ...track,
        devices: track.devices.map((candidate) =>
            candidate.id === deviceId ? { ...candidate, externalStateChunk: stateChunk } : candidate
        ),
    }));
    if (device.externalInstanceId) {
        clearExternalPluginRestoreFailure(device.externalInstanceId);
    }
    return true;
}

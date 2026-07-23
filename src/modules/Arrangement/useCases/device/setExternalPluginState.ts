import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

/**
 * Persist a native plugin's opaque state chunk (base64) onto its device in
 * project truth. The authoritative mutation behind the `setExternalPluginState`
 * action: dispatched from the save flow so the chunk rides the CRDT write path
 * and is restored on the next load.
 *
 * Returns false when no device carries the id, so the handler reports a
 * no-write and the CRDT transaction aborts instead of committing an empty diff.
 */
export function setExternalPluginState(deviceId: string, stateChunk: string): boolean {
    const state = getTrackState();
    if (!state) {
        return false;
    }

    const deviceExists = state.tracks.some((track) => track.devices.some((device) => device.id === deviceId));
    if (!deviceExists) {
        return false;
    }

    mapAllTracks((track) => ({
        ...track,
        devices: track.devices.map((device) =>
            device.id === deviceId ? { ...device, externalStateChunk: stateChunk } : device
        ),
    }));
    return true;
}

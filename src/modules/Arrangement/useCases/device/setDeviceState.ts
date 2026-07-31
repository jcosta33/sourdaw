import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

import type { DeviceStateChunk } from '../../models/Track';

export type SetDeviceStateInput = {
    deviceId: string;
    state: DeviceStateChunk;
};

/**
 * Persist a device's own non-automatable state chunk onto its device in project
 * truth. The authoritative mutation behind the `setDeviceState` action, and the
 * sibling of `setExternalPluginState` for a built-in device — the same write path,
 * but a structured subtree the CRDT can merge per field instead of an opaque
 * base64 blob.
 *
 * The host does not interpret `state.data` — the owning module writes it and the
 * owning module reads it back. All that is asserted here is that it reaches project
 * truth, so it rides CRDT persistence, collaboration sync and the `.sourdaw` save
 * exactly like every other device field.
 *
 * Returns false when no device carries the id, so the handler reports a no-write and
 * the CRDT transaction aborts instead of committing an empty diff.
 */
export function setDeviceState(input: SetDeviceStateInput): boolean {
    const state = getTrackState();
    if (!state) {
        return false;
    }

    const deviceExists = state.tracks.some((track) => track.devices.some((device) => device.id === input.deviceId));
    if (!deviceExists) {
        return false;
    }

    mapAllTracks((track) => ({
        ...track,
        devices: track.devices.map((device) =>
            device.id === input.deviceId ? { ...device, deviceState: input.state } : device
        ),
    }));
    return true;
}

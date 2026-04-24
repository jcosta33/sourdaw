import { type Track } from '#/modules/Arrangement/models/Track';
import { getAllTracks } from '#/modules/Arrangement/useCases';

/**
 * §62.3 — The Toaster sequencer calls this at ~100 Hz. The previous
 * implementation did a full tracks.find() scan per tick. Cache the
 * result against the Track[] identity returned by `getAllTracks()`;
 * whenever the track store writes a new snapshot the array reference
 * changes, so identity comparison is sufficient to invalidate the cache.
 */
const cache: { tracks: readonly Track[] | null; deviceId: string | null } = {
    tracks: null,
    deviceId: null,
};

export function getFirstToasterDeviceId(): string | null {
    const tracks = getAllTracks();
    if (tracks === cache.tracks) {
        return cache.deviceId;
    }
    let found: string | null = null;
    for (const track of tracks) {
        const device = track.devices.find((data) => data.type === 'toaster');
        if (device) {
            found = device.id;
            break;
        }
    }
    cache.tracks = tracks;
    cache.deviceId = found;
    return found;
}

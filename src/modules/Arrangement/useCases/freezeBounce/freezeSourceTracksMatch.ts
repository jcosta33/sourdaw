import { type FreezeSources } from './freezeSourceTracks';

/** Same members, and each still holds the clips, devices, mixer key and routes the other read. */
export function freezeSourceTracksMatch(left: FreezeSources, right: FreezeSources): boolean {
    return (
        left.routesKey === right.routesKey &&
        left.tracks.length === right.tracks.length &&
        left.tracks.every((track, index) => {
            const other = right.tracks[index];
            return (
                other !== undefined &&
                other.id === track.id &&
                other.clips === track.clips &&
                other.devices === track.devices &&
                left.mixerKeys[index] === right.mixerKeys[index]
            );
        })
    );
}

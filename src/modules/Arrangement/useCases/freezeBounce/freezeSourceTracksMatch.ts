import { type Track } from '../../models/Track';

/** Same membership, and every member still holds the clips and devices the other list read. */
export function freezeSourceTracksMatch(left: Track[], right: Track[]): boolean {
    return (
        left.length === right.length &&
        left.every((track, index) => {
            const other = right[index];
            return (
                other !== undefined &&
                other.id === track.id &&
                other.clips === track.clips &&
                other.devices === track.devices
            );
        })
    );
}

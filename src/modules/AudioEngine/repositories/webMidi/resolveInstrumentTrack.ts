import { getTargetTrackId } from './getTargetTrackId';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

type Track = NonNullable<TrackStoreState['tracks']>[number];

/**
 * Resolve the instrument-bearing track for the current MIDI target track.
 *
 * Mirrors the resolution `handleNoteOff` performs: a child track whose parent
 * carries a `toaster` device routes to the parent. Returns null when there is
 * no target track or the store is empty.
 */
export function resolveInstrumentTrack(trackState: TrackStoreState | null): Track | null {
    const targetTrackId = getTargetTrackId();
    if (!targetTrackId || !trackState) {
        return null;
    }
    const targetTrack = trackState.tracks.find((time) => time.id === targetTrackId);
    if (!targetTrack) {
        return null;
    }
    if (targetTrack.parentId) {
        const parent = trackState.tracks.find((time) => time.id === targetTrack.parentId);
        if (parent?.devices.some((data) => data.type === 'toaster')) {
            return parent;
        }
    }
    return targetTrack;
}

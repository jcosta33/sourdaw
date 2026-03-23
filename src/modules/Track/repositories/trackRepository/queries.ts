import { trackStore } from '../../stores/trackStore';
import { type Track } from '../../models/Track';

export type TrackState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

/** Read the current track state snapshot. */
export function getTrackState(): TrackState | null {
    return trackStore.value;
}

/** Get all tracks. Returns empty array if store is not initialised. */
export function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

/** Find a single track by id. */
export function getTrackById(trackId: string): Track | undefined {
    return trackStore.value?.tracks.find((t) => t.id === trackId);
}

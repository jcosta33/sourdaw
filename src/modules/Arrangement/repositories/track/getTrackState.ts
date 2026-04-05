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

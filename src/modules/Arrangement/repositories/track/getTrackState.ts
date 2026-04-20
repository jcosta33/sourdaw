import { type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';

export type TrackState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

/** Read the current track state snapshot. */
export function getTrackState(): TrackState | null {
    return trackStore.value;
}

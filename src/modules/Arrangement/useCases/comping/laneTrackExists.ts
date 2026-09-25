import { getTrackStoreState } from '../getTrackStoreState';

/**
 * Whether a lane's own track is still in the project. A lane keyed to a track that
 * is gone has no host: re-inserting it strands the lane and everything it carries,
 * which is the orphan the take-retirement work exists to prevent.
 */
export function laneTrackExists(trackId: string): boolean {
    return (getTrackStoreState()?.tracks ?? []).some((track) => track.id === trackId);
}

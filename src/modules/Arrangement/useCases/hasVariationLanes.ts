import { getVariationLaneCount } from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';

/** Whether any track currently shows variation lanes under its row. */
export function hasVariationLanes(tracks: readonly Track[]): boolean {
    return tracks.some((track) => getVariationLaneCount(track) > 0);
}

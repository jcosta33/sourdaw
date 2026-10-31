import { showsVariationLanes } from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';

/** Whether any track has variation lanes switched on, which is when comping has a track to work on. */
export function hasVariationLanes(tracks: readonly Track[]): boolean {
    return tracks.some(showsVariationLanes);
}

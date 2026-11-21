import { type Track } from '../models/Track';
import { getVisibleTimelineTracks } from '../transformers/getVisibleTimelineTracks';

/** The rows the arrangement draws and its header list lists, in project order. */
export function getTimelineRowTracks(tracks: readonly Track[], showHiddenTracks: boolean): Track[] {
    return getVisibleTimelineTracks(tracks, showHiddenTracks);
}

import { type Track } from '../models/Track';

import { getTimelineTrackHeight, getVisibleTimelineTracks } from './getVisibleTimelineTracks';

/**
 * Total of the canvas's row advance: visible tracks only, each at its rendered
 * height. The canvas and the header list share one scroll range only while they
 * advance by the same rows. Variation lanes are painted over the following row
 * and do not advance it, so they add nothing here.
 */
export function getTimelineContentHeight(tracks: readonly Track[]): number {
    return getVisibleTimelineTracks(tracks).reduce((sum, track) => sum + getTimelineTrackHeight(track), 0);
}

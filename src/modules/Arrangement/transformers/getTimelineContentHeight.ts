import { getVariationLaneExtent } from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';

import { getTimelineTrackHeight, getVisibleTimelineTracks } from './getVisibleTimelineTracks';

/**
 * Total height of the rows the timeline canvas lays out: visible tracks only,
 * each its own row plus the block of variation lanes under it. This is the
 * canvas's row advance (`getRenderedTrackExtent`), and the scroll range the
 * canvas and the header list share.
 */
export function getTimelineContentHeight(tracks: readonly Track[]): number {
    return getVisibleTimelineTracks(tracks).reduce(
        (sum, track) => sum + getTimelineTrackHeight(track) + getVariationLaneExtent(track),
        0
    );
}

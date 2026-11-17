import {
    getTimelineTrackHeight,
    getVariationLaneExtent,
    type TimelineTrackHeightPreview,
} from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';

import { getVisibleTimelineTracks } from './getVisibleTimelineTracks';

/**
 * Total height of the rows the timeline canvas lays out: visible tracks only,
 * each its own row plus the block of variation lanes under it. This is the
 * canvas's row advance (`getRenderedTrackExtent`), and the scroll range the
 * canvas and the header list share.
 */
export function getTimelineContentHeight(
    tracks: readonly Track[],
    trackHeightScale = 1,
    trackHeightPreview?: TimelineTrackHeightPreview | null
): number {
    return getVisibleTimelineTracks(tracks).reduce(
        (sum, track) =>
            sum + getTimelineTrackHeight(track, trackHeightScale, trackHeightPreview) + getVariationLaneExtent(track),
        0
    );
}

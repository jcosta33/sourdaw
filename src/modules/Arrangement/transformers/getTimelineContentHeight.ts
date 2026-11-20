import {
    getAutomationSubLaneTop,
    getTimelineTrackHeight,
    getVariationLaneCount,
    type TimelineTrackHeightPreview,
} from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';

import { getVisibleTimelineTracks } from './getVisibleTimelineTracks';

/**
 * Total height of the rows the timeline canvas lays out: visible tracks only,
 * each its own row plus its variation and automation lanes. This is the
 * canvas's row advance (`getRenderedTrackExtent`), and the scroll range the
 * canvas and the header list share.
 */
export function getTimelineContentHeight(
    tracks: readonly Track[],
    automationRows?: ReadonlyMap<string, readonly unknown[]>,
    trackHeightScale = 1,
    trackHeightPreview?: TimelineTrackHeightPreview | null
): number {
    return getVisibleTimelineTracks(tracks).reduce(
        (sum, track) =>
            sum +
            getAutomationSubLaneTop(
                getTimelineTrackHeight(track, trackHeightScale, trackHeightPreview),
                getVariationLaneCount(track),
                automationRows?.get(track.id)?.length
            ),
        0
    );
}

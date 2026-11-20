import { getAutomationSubLaneTop, getVariationLaneCount } from '../models/TimelineTrackExtent';
import { type Track } from '../models/Track';

import { getTimelineTrackHeight, getVisibleTimelineTracks } from './getVisibleTimelineTracks';

/**
 * Total height of the rows the timeline canvas lays out: visible tracks only,
 * each its own row plus its variation and automation lanes. This is the
 * canvas's row advance (`getRenderedTrackExtent`), and the scroll range the
 * canvas and the header list share.
 */
export function getTimelineContentHeight(
    tracks: readonly Track[],
    automationRows?: ReadonlyMap<string, readonly unknown[]>
): number {
    return getVisibleTimelineTracks(tracks).reduce(
        (sum, track) =>
            sum +
            getAutomationSubLaneTop(
                getTimelineTrackHeight(track),
                getVariationLaneCount(track),
                automationRows?.get(track.id)?.length
            ),
        0
    );
}

import { type Track } from '../models/Track';

import { getTimelineTrackHeight, getVisibleTimelineTracks } from './getVisibleTimelineTracks';

/**
 * Total height of the rows the timeline canvas lays out: visible tracks only,
 * each at its rendered height. The canvas renderers advance their row offset by
 * exactly this per track and add nothing for variation lanes, so this is the
 * scroll range both the canvas and the header list must share.
 */
export function getTimelineContentHeight(tracks: readonly Track[]): number {
    return getVisibleTimelineTracks(tracks).reduce((sum, track) => sum + getTimelineTrackHeight(track), 0);
}

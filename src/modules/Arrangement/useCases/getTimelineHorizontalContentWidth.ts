import { getTimelineHorizontalContentWidth as getContentWidth } from '../models/TimelineHorizontalExtent';

type TimelineExtentTrack = { clips: readonly { endBeat: number }[] };

export function getTimelineHorizontalContentWidth(
    tracks: readonly TimelineExtentTrack[],
    pixelsPerBeat: number
): number {
    return getContentWidth(tracks, pixelsPerBeat);
}

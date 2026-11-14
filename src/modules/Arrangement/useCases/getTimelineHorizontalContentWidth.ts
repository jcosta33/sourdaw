import {
    getTimelineHorizontalContentWidth as getContentWidth,
    type TimelineExtentTrack,
} from '../models/TimelineHorizontalExtent';

export function getTimelineHorizontalContentWidth(
    tracks: readonly TimelineExtentTrack[],
    pixelsPerBeat: number
): number {
    return getContentWidth(tracks, pixelsPerBeat);
}

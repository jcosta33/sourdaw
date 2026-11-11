import { getArrangementEndBeat } from './ArrangementEnd';

export const MIN_TIMELINE_CONTENT_BEATS = 256;

type TimelineExtentTrack = { clips: readonly { endBeat: number }[] };

/** The single horizontal navigation extent shared by the scrollbar and scroll clamps. */
export function getTimelineHorizontalContentWidth(
    tracks: readonly TimelineExtentTrack[],
    pixelsPerBeat: number
): number {
    return Math.max(MIN_TIMELINE_CONTENT_BEATS, getArrangementEndBeat(tracks)) * pixelsPerBeat;
}

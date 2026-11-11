import { getArrangementEndBeat } from './ArrangementEnd';
import { showsVariationLanes } from './TimelineTrackExtent';
import { getHeldClips } from './TrackAlternativeClips';
import { type Track } from './Track';

export const MIN_TIMELINE_CONTENT_BEATS = 256;

export type TimelineExtentTrack = {
    clips: { endBeat: number }[];
    activeAlternativeId?: string;
    alternatives?: { id: string; clips: { endBeat: number }[] }[];
    kind?: Track['kind'];
    showVariationLanes?: boolean;
};

function getDrawnClips(track: TimelineExtentTrack): readonly { endBeat: number }[] {
    if (
        track.kind === undefined ||
        track.activeAlternativeId === undefined ||
        track.alternatives === undefined ||
        !showsVariationLanes(track)
    ) {
        return track.clips;
    }
    return getHeldClips({
        activeAlternativeId: track.activeAlternativeId,
        clips: track.clips,
        alternatives: track.alternatives,
    });
}

/** The single horizontal navigation extent shared by the scrollbar and scroll clamps. */
export function getTimelineHorizontalContentWidth(
    tracks: readonly TimelineExtentTrack[],
    pixelsPerBeat: number
): number {
    const drawnTracks = tracks.map((track) => ({ clips: getDrawnClips(track) }));
    return Math.max(MIN_TIMELINE_CONTENT_BEATS, getArrangementEndBeat(drawnTracks)) * pixelsPerBeat;
}

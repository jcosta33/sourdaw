import { getVariationLaneExtent } from '../models/TimelineTrackExtent';
import { setScrollX, setScrollY, timelineViewStore } from '../stores/timelineViewStore';
import { trackStore } from '../stores/trackStore';
import { getTimelineTrackHeight, getVisibleTimelineTracks } from '../transformers/getVisibleTimelineTracks';

import { selectClipWithFocus } from './clipSelection/selectClipWithFocus';

const REVEAL_HORIZONTAL_MARGIN_PX = 32;

/** Select an active clip and bring its track and start into view without changing zoom. */
export function revealClip(clipId: string): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    const visibleTracks = getVisibleTimelineTracks(tracks);
    const trackIndex = visibleTracks.findIndex((track) => track.clips.some((clip) => clip.id === clipId));
    const track = visibleTracks[trackIndex];
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    const view = timelineViewStore.value;
    if (!track || !clip || !view) {
        return false;
    }

    let trackTop = 0;
    for (let index = 0; index < trackIndex; index++) {
        const preceding = visibleTracks[index]!;
        trackTop += getTimelineTrackHeight(preceding) + getVariationLaneExtent(preceding);
    }
    const trackBottom = trackTop + getTimelineTrackHeight(track);
    const viewportHeight = view.viewportHeight ?? 0;
    if (trackTop < view.scrollY) {
        setScrollY(trackTop);
    } else if (trackBottom > view.scrollY + viewportHeight) {
        setScrollY(trackBottom - viewportHeight);
    }
    setScrollX(Math.max(0, clip.startBeat * view.pixelsPerBeat - REVEAL_HORIZONTAL_MARGIN_PX));
    selectClipWithFocus(clipId);
    return true;
}

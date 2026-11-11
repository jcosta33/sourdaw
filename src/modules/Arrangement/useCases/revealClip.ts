import { getVariationLaneExtent, VARIATION_LANE_HEIGHT } from '../models/TimelineTrackExtent';
import { type Clip, type Track } from '../models/Track';
import { setScrollX, setScrollY, timelineViewStore } from '../stores/timelineViewStore';
import { trackStore } from '../stores/trackStore';
import { getTimelineTrackHeight, getVisibleTimelineTracks } from '../transformers/getVisibleTimelineTracks';

import { selectClipWithFocus } from './clipSelection/selectClipWithFocus';
import { toggleFolderCollapse } from './folder/toggleFolderCollapse';
import { toggleVariationLanes } from './toggleTrackState/toggleVariationLanes';

const REVEAL_HORIZONTAL_MARGIN_PX = 32;

type LocatedClip = {
    track: Track;
    clip: Clip;
    variationLaneIndex: number | null;
};

function locateClip(tracks: readonly Track[], clipId: string): LocatedClip | null {
    for (const track of tracks) {
        const activeClip = track.clips.find((clip) => clip.id === clipId);
        if (activeClip) {
            return { track, clip: activeClip, variationLaneIndex: null };
        }
        for (const [index, alternative] of track.alternatives.entries()) {
            if (alternative.id === track.activeAlternativeId) {
                continue;
            }
            const alternativeClip = alternative.clips.find((clip) => clip.id === clipId);
            if (alternativeClip) {
                return { track, clip: alternativeClip, variationLaneIndex: index };
            }
        }
    }
    return null;
}

function expandOwningFolders(tracks: readonly Track[], track: Track): void {
    let parentId = track.parentId;
    while (parentId) {
        const parent = tracks.find((candidate) => candidate.id === parentId);
        if (!parent) {
            return;
        }
        if (parent.kind === 'folder' && parent.collapsed) {
            toggleFolderCollapse(parent.id);
        }
        parentId = parent.parentId;
    }
}

/** Select a held clip and bring its row and start into view without changing zoom. */
export function revealClip(clipId: string): boolean {
    const tracks = trackStore.value?.tracks ?? [];
    const located = locateClip(tracks, clipId);
    const view = timelineViewStore.value;
    if (!located || !view) {
        return false;
    }

    expandOwningFolders(tracks, located.track);
    if (located.variationLaneIndex !== null) {
        toggleVariationLanes(located.track.id, true);
    }

    const visibleTracks = getVisibleTimelineTracks(trackStore.value?.tracks ?? []);
    const trackIndex = visibleTracks.findIndex((track) => track.id === located.track.id);
    const track = visibleTracks[trackIndex];
    if (!track) {
        return false;
    }

    let trackTop = 0;
    for (let index = 0; index < trackIndex; index++) {
        const preceding = visibleTracks[index]!;
        trackTop += getTimelineTrackHeight(preceding) + getVariationLaneExtent(preceding);
    }
    let targetTop = trackTop;
    let targetBottom = trackTop + getTimelineTrackHeight(track);
    if (located.variationLaneIndex !== null) {
        targetTop = trackTop + getTimelineTrackHeight(track) + located.variationLaneIndex * VARIATION_LANE_HEIGHT;
        targetBottom = targetTop + VARIATION_LANE_HEIGHT;
    }
    const viewportHeight = view.viewportHeight ?? 0;
    if (targetTop < view.scrollY) {
        setScrollY(targetTop);
    } else if (targetBottom > view.scrollY + viewportHeight) {
        setScrollY(targetBottom - viewportHeight);
    }
    setScrollX(Math.max(0, located.clip.startBeat * view.pixelsPerBeat - REVEAL_HORIZONTAL_MARGIN_PX));
    selectClipWithFocus(clipId);
    return true;
}

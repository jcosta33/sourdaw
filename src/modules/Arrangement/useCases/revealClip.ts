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

function getClipVerticalBounds(
    visibleTracks: readonly Track[],
    located: LocatedClip
): { top: number; bottom: number } | null {
    let trackTop = 0;
    for (const track of visibleTracks) {
        if (track.id !== located.track.id) {
            trackTop += getTimelineTrackHeight(track) + getVariationLaneExtent(track);
            continue;
        }
        const trackHeight = getTimelineTrackHeight(track);
        if (located.variationLaneIndex !== null) {
            const top = trackTop + trackHeight + located.variationLaneIndex * VARIATION_LANE_HEIGHT;
            return { top, bottom: top + VARIATION_LANE_HEIGHT };
        }
        return { top: trackTop, bottom: trackTop + trackHeight };
    }
    return null;
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
    const bounds = getClipVerticalBounds(visibleTracks, located);
    if (!bounds) {
        return false;
    }

    const viewportHeight = view.viewportHeight ?? 0;
    if (bounds.top < view.scrollY) {
        setScrollY(bounds.top);
    } else if (bounds.bottom > view.scrollY + viewportHeight) {
        setScrollY(bounds.bottom - viewportHeight);
    }
    setScrollX(Math.max(0, located.clip.startBeat * view.pixelsPerBeat - REVEAL_HORIZONTAL_MARGIN_PX));
    selectClipWithFocus(clipId);
    return true;
}

import { type Clip, type Track } from '../models/Track';
import { timelineEditingStore } from '../stores/timelineEditingStore';
import { trackStore } from '../stores/trackStore';
import { getVisibleTimelineTracks } from '../transformers/getVisibleTimelineTracks';

type TimelineClip = { clip: Clip; track: Track; key: string };

const EMPTY_TRACKS: readonly Track[] = [];
let lastTracks: readonly Track[] | null = null;
let lastShowHiddenTracks = false;
let lastClips: readonly TimelineClip[] = [];

export function getTimelineClipNavigationSnapshot(): readonly TimelineClip[] {
    const tracks = trackStore.value?.tracks ?? EMPTY_TRACKS;
    const showHiddenTracks = timelineEditingStore.value?.showHiddenTracks ?? false;
    if (tracks === lastTracks && showHiddenTracks === lastShowHiddenTracks) {
        return lastClips;
    }

    lastTracks = tracks;
    lastShowHiddenTracks = showHiddenTracks;
    lastClips = getVisibleTimelineTracks(tracks, showHiddenTracks).flatMap((track) =>
        [...track.clips]
            .sort((left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id))
            .map((clip) => ({ clip, track, key: `${track.id}:${clip.id}` }))
    );
    return lastClips;
}

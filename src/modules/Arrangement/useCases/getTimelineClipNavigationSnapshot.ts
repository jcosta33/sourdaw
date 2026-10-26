import { type Clip, type Track } from '../models/Track';
import { trackStore } from '../stores/trackStore';
import { getVisibleTimelineTracks } from '../transformers/getVisibleTimelineTracks';

type TimelineClip = { clip: Clip; track: Track; key: string };

const EMPTY_TRACKS: readonly Track[] = [];
let lastTracks: readonly Track[] | null = null;
let lastClips: readonly TimelineClip[] = [];

export function getTimelineClipNavigationSnapshot(): readonly TimelineClip[] {
    const tracks = trackStore.value?.tracks ?? EMPTY_TRACKS;
    if (tracks === lastTracks) {
        return lastClips;
    }

    lastTracks = tracks;
    lastClips = getVisibleTimelineTracks(tracks).flatMap((track) =>
        [...track.clips]
            .sort((left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id))
            .map((clip) => ({ clip, track, key: `${track.id}:${clip.id}` }))
    );
    return lastClips;
}

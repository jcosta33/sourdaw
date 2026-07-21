import { type Clip, type Track } from '../../models/Track';
import { createClipWriteTargetIndex } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

/** Update clips on all tracks with a mapper function. */
export function updateClipsOnAllTracks(mapper: (clip: Clip) => Clip): boolean {
    let state;
    try {
        state = trackStore.value;
    } catch {
        return false;
    }

    const index = createClipWriteTargetIndex(state);
    if (index.status !== 'valid') {
        return false;
    }

    let didMapClip = false;
    const nextTracks: Track[] = [];
    for (const track of index.tracks) {
        if (!track.acceptsClipUpdate || track.clips.length === 0) {
            nextTracks.push(track.source);
            continue;
        }

        const nextClips: Clip[] = [];
        for (const clip of track.clips) {
            didMapClip = true;
            nextClips.push(mapper(clip.source));
        }

        nextTracks.push({ ...track.snapshot, clips: nextClips });
    }

    if (!didMapClip) {
        return false;
    }

    trackStore.set({ ...index.snapshot, tracks: nextTracks });
    return true;
}

import { type Clip, type Track } from '../../models/Track';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

/** Update clips on all tracks with a mapper function. */
export function updateClipsOnAllTracks(mapper: (clip: Clip) => Clip): boolean {
    const state = trackStore.value;
    if (!state) {
        return false;
    }

    let didMapClip = false;
    const nextTracks: Track[] = [];
    for (const track of state.tracks) {
        let didMapTrackClip = false;
        const nextClips: Clip[] = [];
        for (const clip of track.clips) {
            const target = resolveEligibleClipWriteTarget({ clipId: clip.id });
            if (target.status !== 'eligible') {
                nextClips.push(clip);
                continue;
            }

            didMapClip = true;
            didMapTrackClip = true;
            nextClips.push(mapper(clip));
        }

        if (!didMapTrackClip) {
            nextTracks.push(track);
            continue;
        }

        nextTracks.push({ ...track, clips: nextClips });
    }

    if (!didMapClip) {
        return false;
    }

    trackStore.set({ ...state, tracks: nextTracks });
    return true;
}

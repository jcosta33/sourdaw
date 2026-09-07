import { type TrackState } from '../../repositories/track/getTrackState';

/** Audio buffer ids referenced by any clip in a collection of tracks. */
export function collectTracksClipBufferIds(tracks: TrackState['tracks']): string[] {
    const ids = new Set<string>();
    for (const track of tracks) {
        for (const clip of track.clips) {
            if (typeof clip.audioBufferId === 'string') {
                ids.add(clip.audioBufferId);
            }
        }
    }
    return [...ids];
}

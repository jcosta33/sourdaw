import { type Track } from '../models/Track';
import { getHeldClips } from '../models/TrackAlternativeClips';

type CollectLiveClipIdsTrack = Pick<Track, 'activeAlternativeId' | 'clips' | 'alternatives'>;

/**
 * The id of every clip the project holds now — the liveness rule every take
 * replay follows: a take whose clip is gone has no material to resolve
 * against, so it is never written back. A track holds what `getHeldClips`
 * says: its own `clips` plus each inactive alternative's stored clips. The
 * active alternative's stored copy is stale between switches, so a clip
 * deleted from the main row is not live even while that copy still names it.
 * Callers reusing the set across a batch collect it once and share it.
 */
export function collectLiveClipIds(tracks: readonly CollectLiveClipIdsTrack[]): Set<string> {
    const collected = new Set<string>();
    for (const track of tracks) {
        for (const clip of getHeldClips(track)) {
            collected.add(clip.id);
        }
    }
    return collected;
}

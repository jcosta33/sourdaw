import { collectTrackClipIds } from './collectTrackClipIds';

type CollectLiveClipIdsTrack = Parameters<typeof collectTrackClipIds>[0];

/**
 * The id of every clip the project currently holds — the liveness rule every
 * take replay follows: a take whose clip is gone has no material to resolve
 * against, so it is never written back. Callers reusing the set across a
 * batch collect it once and share it.
 */
export function collectLiveClipIds(tracks: readonly CollectLiveClipIdsTrack[]): Set<string> {
    const collected = new Set<string>();
    for (const track of tracks) {
        for (const clipId of collectTrackClipIds(track)) {
            collected.add(clipId);
        }
    }
    return collected;
}

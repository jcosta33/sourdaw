import { trackStore } from '#/modules/Arrangement/stores';

import { kneadStore, type KneadClipState } from '../stores/kneadStore';

/**
 * Shallow value-equality for the per-clip Knead state maps. Compares each
 * entry by reference, since clip states are replaced wholesale (never mutated
 * in place) by {@link updateClipKneadState} and the trackStore projection.
 */
function clipsAreEqual(a: Record<string, KneadClipState>, b: Record<string, KneadClipState>): boolean {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) {
        return false;
    }
    for (const key of aKeys) {
        if (a[key] !== b[key]) {
            return false;
        }
    }
    return true;
}

/**
 * Hydrates the kneadStore with pitch-correction data extracted from
 * the clips in the trackStore.
 *
 * Merges trackStore-derived clip state on top of the existing kneadStore
 * clips rather than replacing them wholesale. This preserves session-only
 * in-memory blobs for clips that live in the kneadStore but have not yet
 * round-tripped into the projected Arrangement doc — without it, an
 * unrelated Automerge change would clobber unpersisted edits. The store is
 * only written when the merged result actually differs, so re-projecting an
 * unchanged document does not spuriously trigger downstream engine re-syncs.
 */
export function hydrateKneadFromTrackStore(): void {
    const trackStoreValue = trackStore.value;
    if (!trackStoreValue) {
        return;
    }

    const currentKnead = kneadStore.value;
    if (!currentKnead) {
        return;
    }

    const { tracks } = trackStoreValue;
    // Start from the existing clips so in-memory-only entries (clips not yet
    // represented in the projected trackStore) survive the re-hydrate.
    const mergedClips: Record<string, KneadClipState> = { ...currentKnead.clips };

    for (const track of tracks) {
        for (const clip of track.clips) {
            if (clip.kneadState) {
                mergedClips[clip.id] = clip.kneadState as KneadClipState;
            }
        }
    }

    if (clipsAreEqual(currentKnead.clips, mergedClips)) {
        return;
    }

    kneadStore.set({
        ...currentKnead,
        clips: mergedClips,
    });
}

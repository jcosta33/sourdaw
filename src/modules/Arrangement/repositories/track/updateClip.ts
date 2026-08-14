import { type Clip } from '../../models/Track';
import { updateClipInStore } from '../../stores/updateClipInStore';

/**
 * Update a single clip by id across all tracks.
 *
 * §107.5 — only clone the one track that actually contains the clip, plus a
 * shallow-cloned tracks array; avoids the full-project clone recording
 * finalize used to pay up to 2× per armed track.
 *
 * F8 — this used to carry its own byte-identical copy of that logic
 * alongside `stores/updateClipInStore.ts`; delegating keeps a single
 * implementation so a behaviour change can no longer silently miss one side.
 */
export function updateClip(clipId: string, updater: (clip: Clip) => Clip): boolean {
    return updateClipInStore(clipId, updater);
}

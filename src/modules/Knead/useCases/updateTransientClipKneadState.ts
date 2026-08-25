import { type KneadClipState } from '../stores/kneadStore';

import { applyKneadClipState } from './applyKneadClipState';

/**
 * The derived path: publish to the Knead store only. Analysis blobs are
 * machine-derived from the clip's audio, not chosen by anyone, so they must not
 * author project state — a clip that was merely selected while pitch mode is
 * open gains no persisted `kneadState` (#2557). The editor reads the Knead
 * store, so an analysis-only clip shows its blobs and the seeded default
 * settings exactly as an edited clip does, and the first real edit through
 * `updateClipKneadState` persists the whole state, analysis included.
 */
export function updateTransientClipKneadState(
    clipId: string,
    updater: (state: KneadClipState) => KneadClipState
): void {
    applyKneadClipState(clipId, updater);
}

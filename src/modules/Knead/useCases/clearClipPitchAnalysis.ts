import { updateClipInStore } from '#/modules/Arrangement/stores';

import { kneadStore } from '../stores/kneadStore';

/**
 * Drop everything the pitch analysis produced for a clip: the raw contour and the
 * editable blobs derived from it. Called when the analysis no longer describes the
 * clip's audio — after a successful pitch commit, and whenever the clip's audio is
 * replaced (file drop, reverse).
 *
 * The two must fall together. The Knead editor re-runs analysis only while a clip
 * has neither, and it is the product's only caller of `analyzeClipPitch` — so
 * leaving blobs behind holds that gate shut permanently. Worse, blobs are the live
 * pitch shift: `syncKneadToEngine` pushes them to the Knead worklet, which keeps
 * applying `pitchCenterCents - originalPitchCenterCents` on top of whatever audio
 * the clip now points at. Stale blobs over re-rendered or replaced audio are a
 * second, unasked-for shift, and they are CRDT-persisted, so it survives reload and
 * reaches collaborators.
 *
 * No-op for a clip the store knows nothing about: seeding a default clip state here
 * would write knead defaults for a clip that never had any.
 */
export function clearClipPitchAnalysis(clipId: string): void {
    const state = kneadStore.value;
    if (!state) {
        return;
    }

    const hasContour = clipId in state.contours;
    const clipState = state.clips[clipId];
    const hasBlobs = (clipState?.blobs.length ?? 0) > 0;
    if (!hasContour && !hasBlobs) {
        return;
    }

    const contours = { ...state.contours };
    delete contours[clipId];

    const clips = { ...state.clips };
    const clearedClipState = clipState && hasBlobs ? { ...clipState, blobs: [] } : clipState;
    if (clearedClipState) {
        clips[clipId] = clearedClipState;
    }

    kneadStore.set({ ...state, contours, clips });

    // Blobs live in two places: the Knead store and the clip's own `kneadState` on
    // the track store, which is what persistence and collaboration read. Clearing
    // only the Knead store would let `hydrateKneadFromTrackStore` put them straight
    // back on the next load.
    if (clearedClipState && clearedClipState !== clipState) {
        updateClipInStore(clipId, (clip) => ({ ...clip, kneadState: clearedClipState }));
    }
}

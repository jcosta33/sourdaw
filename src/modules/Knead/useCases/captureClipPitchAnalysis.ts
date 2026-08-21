import { type KneadPitchBlobSnapshot, type PitchContourSnapshot } from '#/utils/handlerContract';

import { kneadStore } from '../stores/kneadStore';

export type ClipPitchAnalysisSnapshot = {
    blobs?: KneadPitchBlobSnapshot[];
    contour?: PitchContourSnapshot;
};

/**
 * Capture what `clearClipPitchAnalysis` would drop, in the shape `restoreClipPitchAnalysis`
 * takes back. Any action that replaces a clip's audio clears the analysis, and undoing
 * such an action has to give the contour and the user's edited blobs back together — the
 * editor re-runs analysis only while a clip has neither, and the blobs are the live pitch
 * shift the Knead worklet applies.
 *
 * Absent keys mean the clip genuinely had none, which is what the restore treats as
 * "clear" rather than "preserve", so a round trip through a clip with no analysis is a
 * no-op rather than a resurrection.
 */
export function captureClipPitchAnalysis(clipId: string): ClipPitchAnalysisSnapshot {
    const state = kneadStore.value;
    if (!state) {
        return {};
    }

    const snapshot: ClipPitchAnalysisSnapshot = {};
    const blobs = state.clips[clipId]?.blobs;
    if (blobs && blobs.length > 0) {
        snapshot.blobs = blobs.map((blob) => ({ ...blob, pitchCurveCents: [...blob.pitchCurveCents] }));
    }
    const contour = state.contours[clipId];
    if (contour) {
        snapshot.contour = { ...contour, points: [...contour.points] };
    }
    return snapshot;
}

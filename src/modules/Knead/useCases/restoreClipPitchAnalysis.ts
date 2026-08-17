import { updateClipInStore } from '#/modules/Arrangement/stores';
import { type KneadPitchBlobSnapshot, type PitchContourSnapshot } from '#/utils/handlerContract';

import { kneadStore, type NoteBlob } from '../stores/kneadStore';

type RestoreClipPitchAnalysisInput = {
    blobs?: KneadPitchBlobSnapshot[];
    contour?: PitchContourSnapshot;
};

/** The snapshot leaves `originalPitchCenterCents` off when the blob it captured had
 *  none — the field is absent from the persisted clip shape, so blobs written before
 *  it existed rehydrate without it. Restoring it as "no shift" is what the Knead
 *  worklet and the commit's own segment build already do with a missing original, so
 *  the round trip changes no behaviour. */
function toNoteBlob(snapshot: KneadPitchBlobSnapshot): NoteBlob {
    const original = snapshot.originalPitchCenterCents;
    const restoredOriginal = original !== undefined && Number.isFinite(original) ? original : snapshot.pitchCenterCents;
    return {
        id: snapshot.id,
        startTime: snapshot.startTime,
        endTime: snapshot.endTime,
        pitchCenterCents: snapshot.pitchCenterCents,
        originalPitchCenterCents: restoredOriginal,
        pitchCurveCents: [...snapshot.pitchCurveCents],
        voicedConfidence: snapshot.voicedConfidence,
        driftPercent: snapshot.driftPercent,
        vibratoDepthPercent: snapshot.vibratoDepthPercent,
        vibratoRateHz: snapshot.vibratoRateHz,
        formantShiftCents: snapshot.formantShiftCents,
        gainDb: snapshot.gainDb,
        muted: snapshot.muted,
    };
}

/**
 * Put a clip's pitch analysis back — the inverse of `clearClipPitchAnalysis`, used
 * when undoing a pitch commit. Restores the contour and the user's edited blobs
 * together, for the same reason they are dropped together: blobs are the live shift
 * the Knead worklet applies, and the editor re-runs analysis only while a clip has
 * neither. Restoring one without the other leaves the clip in a state the forward
 * path never produces.
 *
 * Absent input clears rather than preserves: a commit on a clip that genuinely had
 * no blobs must undo back to no blobs, not to whatever is there now.
 */
export function restoreClipPitchAnalysis(clipId: string, { blobs, contour }: RestoreClipPitchAnalysisInput): void {
    const state = kneadStore.value;
    if (!state) {
        return;
    }

    const contours = { ...state.contours };
    if (contour) {
        contours[clipId] = { ...contour, points: [...contour.points] };
    } else {
        delete contours[clipId];
    }

    const clips = { ...state.clips };
    const existing = clips[clipId];
    const restoredBlobs = (blobs ?? []).map(toNoteBlob);
    const restoredClipState = existing ? { ...existing, blobs: restoredBlobs } : undefined;
    if (restoredClipState) {
        clips[clipId] = restoredClipState;
    }

    kneadStore.set({ ...state, contours, clips });

    // Blobs are mirrored onto the clip's own `kneadState`, which is what persistence
    // and collaboration read; leaving that mirror on the post-commit empty list would
    // undo the edit on screen and put it straight back on the next load.
    if (restoredClipState) {
        updateClipInStore(clipId, (clip) => ({ ...clip, kneadState: restoredClipState }));
    }
}

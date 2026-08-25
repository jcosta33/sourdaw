import { type ClipKneadBlob, type ClipKneadState } from '#/modules/Arrangement/stores';

import { type KneadClipState, type NoteBlob } from '../stores/kneadStore';

/**
 * Project a Knead store clip state onto the shape the clip persists (#2571).
 *
 * `clip.kneadState` is project truth carrying only the settings `ClipKneadState`
 * declares; Knead-owned tuning (the tolerances and every per-blob extra) stays in
 * the knead store, which is the only thing the editor and engine read. Without
 * this projection the clip briefly carried the store-shaped state, so a clip held
 * one shape after an edit and another after the first document-origin projection
 * — two shapes for one authored state, with the projection silently dropping the
 * Knead-owned fields. Projecting at every persisting write makes a fresh edit and
 * a projection produce the same value.
 *
 * The declared type is the contract, with one limit: a key `ClipKneadState` or
 * `ClipKneadBlob` REQUIRES fails to compile here until this projection carries
 * it, but a merely OPTIONAL key compiles silently when missing — the write path
 * then drops a field the document normalizer keeps (`originalPitchCenterCents`
 * on `ClipKneadBlob` is exactly that pattern). An optional declared key must be
 * added to this projection by hand. A key added to the store state simply never
 * reaches project truth.
 */
function projectKneadBlob(blob: NoteBlob): ClipKneadBlob {
    return {
        id: blob.id,
        startTime: blob.startTime,
        endTime: blob.endTime,
        pitchCenterCents: blob.pitchCenterCents,
        originalPitchCenterCents: blob.originalPitchCenterCents,
        pitchCurveCents: blob.pitchCurveCents,
        voicedConfidence: blob.voicedConfidence,
    };
}

export function projectClipKneadState(state: KneadClipState): ClipKneadState {
    return {
        blobs: state.blobs.map(projectKneadBlob),
        retuneSpeedMs: state.retuneSpeedMs,
        humanizePercent: state.humanizePercent,
        formantPreserve: state.formantPreserve,
    };
}

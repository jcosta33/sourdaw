import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { updateClipInStore } from '#/modules/Arrangement/stores';
import { type PitchContourSnapshot, type PitchEditSegmentSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { basename_from_path } from '#/utils/path-basename';

import { clearClipPitchAnalysis } from '../clearClipPitchAnalysis';

import { findPitchEditClip } from './findPitchEditClip';
import { getPitchEditDependencies } from './getPitchEditDependencies';

export type CommitPitchEditInput = {
    clipId: string;
    segments: PitchEditSegmentSnapshot[];
    contour: PitchContourSnapshot;
    /** Live retune speed and formant-preserve selection the bake must carry
     *  (#2058): after the commit the analysis is cleared, so a setting the
     *  render drops is gone, not corrected later. */
    retuneSpeedMs?: number;
    formantPreserve?: boolean;
};

/**
 * The root the native commit writes its render into, expressed as the
 * renderer's spelling for "inside a directory the app owns": the native path
 * guard joins a relative path onto the app's own IPC scratch root, which is
 * writable without any user grant. An absolute output, in contrast, is checked
 * against user grants — and a desktop open-file pick grants the picked file
 * for reading only (#3404), so deriving `<source>_pitch.wav` beside the source
 * was refused with `Path is outside allowed native file roots` and the WASM
 * fallback became the only renderer that could succeed (#3406).
 */
const PITCH_EDIT_OUTPUT_ROOT = 'pitch-edits';

/**
 * The native output path for one commit. The clip id disambiguates sources
 * that share a file name, so two clips' renders never overwrite each other,
 * and the `_pitch` suffix accumulates one segment per commit so successive
 * commits get distinct paths and an undone commit's render is never
 * overwritten by the next one.
 */
function pitchEditOutputAudioPath(clipId: string, sourceFileId: string): string {
    const sourceStem = basename_from_path(sourceFileId).replace(/\.wav$/i, '');
    return `${PITCH_EDIT_OUTPUT_ROOT}/${clipId}/${sourceStem}_pitch.wav`;
}

/**
 * Implementation behind the `commitPitchEdit` AppAction handler. Renders the manual
 * pitch shift through the injected AudioEngine dependency and swaps the clip's file
 * pointer to the rendered output.
 *
 * Undo is handled by the action layer: `handleCommitPitchEdit.describe()` emits a
 * `restoreClipFileId` inverse, and `executeAppAction` pushes the real undo entry — so
 * this function no longer creates its own callback undo entry. On render failure it
 * notifies the user and rethrows, which makes `executeAppAction` skip the undo entry
 * (nothing changed, so nothing to undo).
 */
export async function commitPitchEdit({
    clipId,
    segments,
    contour,
    retuneSpeedMs = 25,
    formantPreserve = false,
}: CommitPitchEditInput): Promise<void> {
    const targetClip = findPitchEditClip(clipId);

    if (!targetClip?.fileId) {
        return;
    }

    const originalFileId = targetClip.fileId;
    const outputAudioPath = pitchEditOutputAudioPath(clipId, originalFileId);
    // Derived from the output path rather than randomly generated: this runs inside
    // a replicated action, where a fresh uuid would differ per peer. The path is a
    // pure function of the clip and its current file, so every peer replaying the
    // action derives the same id.
    const outputAudioBufferId = `audio-pitch:${outputAudioPath}`;

    // Audit CC-10 — both writes below happen after `await renderPitchEdit`, by
    // which point the action's storage transaction is no longer ambient.
    // Captured here, while it still is, so they rejoin the action's commit
    // instead of landing on their own frame — otherwise a rolled-back action
    // still left the clip pointing at the rendered file.
    const scope = captureAutomergeStorageTransactionScope();

    try {
        const { commitPitchEdit: renderPitchEdit } = getPitchEditDependencies();
        const { renderedAudioBufferId } = await renderPitchEdit({
            inputAudioPath: originalFileId,
            outputAudioPath,
            outputAudioBufferId,
            audioBufferId: targetClip.audioBufferId,
            segments,
            contour,
            retuneSpeedMs,
            formantPreserve,
        });

        scope(() => {
            // Both pointers move together, on every platform. `fileId` is the pitch
            // surface's own record of the source file; `audioBufferId` is what
            // playback, export, project reload and the next pitch analysis all
            // resolve — nothing resolves a clip's audio through a path. Leaving it on
            // the pre-edit buffer made the commit inaudible and left the render
            // referenced by nothing, so it was never even saved with the project.
            updateClipInStore(clipId, (clip) => ({
                ...clip,
                fileId: outputAudioPath,
                audioBufferId: renderedAudioBufferId,
            }));
        });

        // The rendered audio replaces the clip's audio, so the analysis that
        // produced this edit no longer describes it — contour and blobs both go.
        // The blobs especially: they are the live shift the Knead worklet applies,
        // and left standing over freshly baked audio they would apply the same
        // shift a second time. Only on success — the catch path rethrows before
        // this point and keeps the edit intact and re-committable.
        scope(() => {
            clearClipPitchAnalysis(clipId);
        });
    } catch (error) {
        // Surface the failure so a failed pitch commit does not look like success:
        // log through the project `logger` facade and notify the user. Rethrow so the
        // dispatch layer records no undo entry for an edit that never landed.
        logger.error(error instanceof Error ? error : new Error(String(error)));
        notifyUser('Failed to commit pitch edit', 'error');
        throw error;
    }
}

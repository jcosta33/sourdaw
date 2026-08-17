import { logger } from '#/infra/logger/appLogger';
import { captureAutomergeStorageTransactionScope } from '#/infra/store/storage/createAutomergeStorage';
import { updateClipInStore } from '#/modules/Arrangement/stores';
import { type PitchContourSnapshot, type PitchEditSegmentSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { clearClipPitchAnalysis } from '../clearClipPitchAnalysis';

import { findPitchEditClip } from './findPitchEditClip';
import { getPitchEditDependencies } from './getPitchEditDependencies';

export type CommitPitchEditInput = {
    clipId: string;
    segments: PitchEditSegmentSnapshot[];
    contour: PitchContourSnapshot;
};

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
export async function commitPitchEdit({ clipId, segments, contour }: CommitPitchEditInput): Promise<void> {
    const targetClip = findPitchEditClip(clipId);

    if (!targetClip?.fileId) {
        return;
    }

    const originalFileId = targetClip.fileId;
    const outputAudioPath = originalFileId.replace('.wav', '_pitch.wav');
    // Derived from the output path rather than randomly generated: this runs inside
    // a replicated action, where a fresh uuid would differ per peer. The path gains
    // a `_pitch` segment per commit, so successive commits get distinct ids and an
    // undone commit's buffer is never overwritten by the next one.
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

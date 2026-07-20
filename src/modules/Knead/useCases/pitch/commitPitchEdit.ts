import { logger } from '#/infra/logger/appLogger';
import { updateClipInStore } from '#/modules/Arrangement/stores';
import { type PitchContourSnapshot, type PitchEditSegmentSnapshot } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { clearClipPitchContour } from '../clearClipPitchContour';

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

    try {
        const { commitPitchEdit: renderPitchEdit } = getPitchEditDependencies();
        await renderPitchEdit({
            inputAudioPath: originalFileId,
            outputAudioPath,
            audioBufferId: targetClip.audioBufferId,
            segments,
            contour,
        });

        updateClipInStore(clipId, (clip) => ({ ...clip, fileId: outputAudioPath }));

        // The rendered `_pitch.wav` replaces the clip's audio, so the pre-commit
        // contour is stale. Drop it to re-open the PitchEditor gate (waveform
        // interactions reachable, Analyze Pitch offered again). Only on success —
        // the catch path rethrows before this point and keeps the contour editable.
        clearClipPitchContour(clipId);
    } catch (error) {
        // Surface the failure so a failed pitch commit does not look like success:
        // log through the project `logger` facade and notify the user. Rethrow so the
        // dispatch layer records no undo entry for an edit that never landed.
        logger.error(error instanceof Error ? error : new Error(String(error)));
        notifyUser('Failed to commit pitch edit', 'error');
        throw error;
    }
}

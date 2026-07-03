import { logger } from '#/infra/logger/appLogger';
import { trackStore, updateClipInStore } from '#/modules/Arrangement/stores';
import { type PitchContour } from '#/modules/Knead/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { commitUndoEntry } from '../commitUndoEntry';
import { createCallbackUndoEntry } from '../createCallbackUndoEntry';

import { getPitchEditDependencies } from './getPitchEditDependencies';

type NoteSegment = {
    start_time_ms: number;
    end_time_ms: number;
    shift_semitones: number;
};

type PitchEditClip = {
    id: string;
    type: 'audio';
    fileId?: string;
    audioBufferId?: string;
};

function findAudioClip(clipId: string): PitchEditClip | null {
    const tracks = trackStore.value?.tracks ?? [];
    for (const track of tracks) {
        for (const clip of track.clips) {
            const candidate: {
                id: string;
                type: 'audio' | 'midi';
                fileId?: string;
                audioBufferId?: string;
            } = clip;
            if (candidate.id === clipId && candidate.type === 'audio') {
                return {
                    id: candidate.id,
                    type: 'audio',
                    fileId: candidate.fileId,
                    audioBufferId: candidate.audioBufferId,
                };
            }
        }
    }
    return null;
}

export async function commitPitchEditCommand(
    clipId: string,
    segments: NoteSegment[],
    contour: PitchContour
): Promise<void> {
    const targetClip = findAudioClip(clipId);

    if (!targetClip?.fileId) {
        return;
    }

    const originalFileId = targetClip.fileId;
    const outputAudioPath = originalFileId.replace('.wav', '_pitch.wav');

    try {
        const { commitPitchEdit } = getPitchEditDependencies();
        await commitPitchEdit({
            inputAudioPath: originalFileId,
            outputAudioPath,
            audioBufferId: targetClip.audioBufferId,
            segments,
            contour,
        });

        function setClipFileId(fileId: string): void {
            updateClipInStore(clipId, (clip) => ({ ...clip, fileId }));
        }

        function undoFn() {
            setClipFileId(originalFileId);
        }

        function redoFn() {
            setClipFileId(outputAudioPath);
        }

        redoFn();

        const entry = createCallbackUndoEntry({
            label: 'Commit Pitch Edit',
            undo: undoFn,
            redo: redoFn,
            source: 'manual',
        });
        commitUndoEntry(entry);
    } catch (error) {
        // Previously the failure was swallowed into `console.error` only, so a
        // failed pitch commit looked like success to the user (no edit applied,
        // no feedback). Surface it through the project `logger` facade (the rest
        // of the module logs that way) and notify the user.
        logger.error(error instanceof Error ? error : new Error(String(error)));
        notifyUser('Failed to commit pitch edit', 'error');
    }
}

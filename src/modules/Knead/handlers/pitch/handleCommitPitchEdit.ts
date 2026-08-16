import { createHandler } from '#/utils/createHandler';
import { type KneadPitchBlobSnapshot } from '#/utils/handlerContract';

import { kneadStore } from '../../stores/kneadStore';
import { commitPitchEdit } from '../../useCases/pitch/commitPitchEdit';
import { findPitchEditClip } from '../../useCases/pitch/findPitchEditClip';

export const handleCommitPitchEdit = createHandler<'commitPitchEdit'>({
    execute: (action) => commitPitchEdit(action.payload),
    describe: (action) => {
        // Capture the pre-edit state BEFORE execute consumes it. When the clip is
        // missing / not audio / has no file, there is nothing to restore, so emit no
        // inverse (executeAppAction leaves an inverse-less entry inert). The forward
        // action re-renders on redo, matching every other action-based undo path.
        const targetClip = findPitchEditClip(action.payload.clipId);
        if (!targetClip?.fileId) {
            return { label: 'Commit Pitch Edit', inverseAction: null };
        }

        // A commit consumes four things, and undo has to give all four back:
        // `fileId` (persistence), `audioBufferId` (playback, export and the next
        // analysis all resolve a clip's audio through it), the edited blobs and the
        // contour. Restoring only the file pointer left the clip playing the baked
        // audio and left the user's pitch edits destroyed — an undo that undoes the
        // label but not the edit.
        const kneadState = kneadStore.value;
        const blobs: KneadPitchBlobSnapshot[] = (kneadState?.clips[action.payload.clipId]?.blobs ?? []).map((blob) => ({
            ...blob,
            pitchCurveCents: [...blob.pitchCurveCents],
        }));
        const storedContour = kneadState?.contours[action.payload.clipId];

        return {
            label: 'Commit Pitch Edit',
            inverseAction: {
                type: 'restoreClipFileId',
                payload: {
                    clipId: action.payload.clipId,
                    fileId: targetClip.fileId,
                    ...(targetClip.audioBufferId === undefined ? {} : { audioBufferId: targetClip.audioBufferId }),
                    blobs,
                    ...(storedContour === undefined
                        ? {}
                        : { contour: { ...storedContour, points: [...storedContour.points] } }),
                },
            },
        };
    },
    undoable: true,
});

import { updateClipInStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';

import { restoreClipPitchAnalysis } from '../../useCases/restoreClipPitchAnalysis';

/**
 * Inverse of `commitPitchEdit`. Puts the clip back exactly as the commit found it:
 * the pre-edit file pointer and audio buffer, and the pitch analysis the commit
 * consumed. The buffer matters as much as the file — playback, export and the next
 * analysis all resolve a clip through `audioBufferId`, so restoring the path alone
 * left the clip still playing the baked render.
 *
 * Only ever dispatched as an inverse action (with `skipUndo`) from the undo engine,
 * so it is not itself undoable.
 */
export const handleRestoreClipFileId = createHandler<'restoreClipFileId'>({
    execute: (action) => {
        const { clipId, fileId, audioBufferId, blobs, contour } = action.payload;
        updateClipInStore(clipId, (clip) => ({
            ...clip,
            fileId,
            ...(audioBufferId === undefined ? {} : { audioBufferId }),
        }));
        restoreClipPitchAnalysis(clipId, { blobs, contour });
    },
    describe: () => ({ label: 'Restore Clip Audio' }),
    undoable: false,
});

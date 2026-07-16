import { updateClipInStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';

/**
 * Inverse of `commitPitchEdit`. Restores a clip's audio file pointer to the pre-edit
 * path. Only ever dispatched as an inverse action (with `skipUndo`) from the undo
 * engine, so it is not itself undoable.
 */
export const handleRestoreClipFileId = createHandler<'restoreClipFileId'>({
    execute: (action) => {
        updateClipInStore(action.payload.clipId, (clip) => ({ ...clip, fileId: action.payload.fileId }));
    },
    describe: () => ({ label: 'Restore Clip Audio' }),
    undoable: false,
});

import { createHandler } from '#/utils/createHandler';

import { commitPitchEdit } from '../../useCases/pitch/commitPitchEdit';
import { findPitchEditClip } from '../../useCases/pitch/findPitchEditClip';

export const handleCommitPitchEdit = createHandler<'commitPitchEdit'>({
    execute: (action) => commitPitchEdit(action.payload),
    describe: (action) => {
        // Capture the pre-edit file pointer BEFORE execute swaps it. When the clip is
        // missing / not audio / has no file, there is nothing to restore, so emit no
        // inverse (executeAppAction leaves an inverse-less entry inert). The forward
        // action re-renders on redo, matching every other action-based undo path.
        const targetClip = findPitchEditClip(action.payload.clipId);
        if (!targetClip?.fileId) {
            return { label: 'Commit Pitch Edit', inverseAction: null };
        }
        return {
            label: 'Commit Pitch Edit',
            inverseAction: {
                type: 'restoreClipFileId',
                payload: { clipId: action.payload.clipId, fileId: targetClip.fileId },
            },
        };
    },
    undoable: true,
});

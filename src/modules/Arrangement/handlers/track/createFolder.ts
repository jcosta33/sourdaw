import { createHandler } from '#/utils/createHandler';

import { createFolder } from '../../useCases/folder/createFolder';

export const handleCreateFolder = createHandler<'createFolder'>({
    execute: (action) => {
        createFolder(action.payload.name, action.payload.folderTrackId);
    },
    describe: (alpha) => {
        const label = `Create folder "${alpha.payload.name}"`;
        const folderTrackId = alpha.payload.folderTrackId;
        // `folderTrackId` is materialized before `describe` runs (see
        // `materializeCommandApplicationIds`). Its absence means the command layer never
        // assigned an id for this dispatch, so there is nothing for an inverse to name.
        if (!folderTrackId) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: {
                type: 'discardCreatedTracks',
                payload: { trackIds: [folderTrackId] },
            },
            redoAction: alpha,
        };
    },
    undoable: true,
});

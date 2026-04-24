import { createHandler } from '#/utils/createHandler';

import { renameTrack } from '../../useCases/renameTrack';

export const handleRenameTrack = createHandler<'renameTrack'>({
    execute: (action) => {
        renameTrack(action.payload.trackId, action.payload.name);
    },
    describe: (alpha) => ({ label: `Rename track to "${alpha.payload.name}"` }),
    undoable: true,
});

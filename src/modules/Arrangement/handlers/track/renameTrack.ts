import { createHandler } from '#/utils/createHandler';

import { renameTrack } from '../../useCases/renameTrack';

export const handleRenameTrack = createHandler<'renameTrack'>({
    execute: (action) => {
        renameTrack(action.payload.trackId, action.payload.name);
    },
    describe: (a) => ({ label: `Rename track to "${a.payload.name}"` }),
    undoable: true,
});

import { createHandler } from '#/utils/createHandler';

import { renameClip } from '../../useCases/clipEditing/renameClip';

export const handleRenameClip = createHandler<'renameClip'>({
    execute: (alpha) => {
        renameClip(alpha.payload.clipId, alpha.payload.name);
    },
    describe: (alpha) => ({ label: `Rename clip to "${alpha.payload.name}"` }),
    undoable: true,
});

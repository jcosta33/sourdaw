import { createHandler } from '#/utils/createHandler';
import { renameClip } from '../../useCases/clipEditing/renameClip';

export const handleRenameClip = createHandler<'renameClip'>({
    execute: (a) => {
        renameClip(a.payload.clipId, a.payload.name);
    },
    describe: (a) => ({ label: `Rename clip to "${a.payload.name}"` }),
    undoable: true,
});

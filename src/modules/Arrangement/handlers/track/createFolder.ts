import { createHandler } from '#/helpers/createHandler';
import { createFolder } from '#/modules/Arrangement/useCases/folder';

export const handleCreateFolder = createHandler<'createFolder'>({
    execute: (action) => {
        createFolder(action.payload.name);
    },
    describe: (a) => ({ label: `Create folder "${a.payload.name}"` }),
    undoable: true,
});

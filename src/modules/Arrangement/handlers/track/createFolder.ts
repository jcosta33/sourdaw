import { createHandler } from '#/utils/createHandler';

import { createFolder } from '../../useCases/folder/createFolder';

export const handleCreateFolder = createHandler<'createFolder'>({
    execute: (action) => {
        createFolder(action.payload.name);
    },
    describe: (alpha) => ({ label: `Create folder "${alpha.payload.name}"` }),
    undoable: false,
});

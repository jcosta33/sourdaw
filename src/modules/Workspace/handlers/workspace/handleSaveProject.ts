import { createHandler } from '#/helpers/createHandler';
import { saveProject } from '#/modules/Project';

export const handleSaveProject = createHandler<'saveProject'>({
    execute: () => {
        saveProject();
    },
    describe: () => ({ label: 'Save project' }),
    undoable: false,
});

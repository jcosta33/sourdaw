import { createHandler } from '#/utils/createHandler';
import { saveProject } from '#/modules/Project/useCases';

export const handleSaveProject = createHandler<'saveProject'>({
    execute: () => {
        saveProject();
    },
    describe: () => ({ label: 'Save project' }),
    undoable: false,
});

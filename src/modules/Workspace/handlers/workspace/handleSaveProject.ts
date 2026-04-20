import { saveProject } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSaveProject = createHandler<'saveProject'>({
    execute: () => {
        saveProject();
    },
    describe: () => ({ label: 'Save project' }),
    undoable: false,
});

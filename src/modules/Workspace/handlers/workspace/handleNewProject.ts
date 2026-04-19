import { createHandler } from '#/utils/createHandler';
import { newProject } from '#/modules/Project/useCases';

export const handleNewProject = createHandler<'newProject'>({
    execute: () => {
        newProject();
    },
    describe: () => ({ label: 'New project' }),
    undoable: false,
});

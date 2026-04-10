import { createHandler } from '#/helpers/createHandler';
import { newProject } from '#/modules/Project';

export const handleNewProject = createHandler<'newProject'>({
    execute: () => {
        newProject();
    },
    describe: () => ({ label: 'New project' }),
    undoable: false,
});

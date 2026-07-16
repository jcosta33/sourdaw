import { newProject } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleNewProject = createHandler<'newProject'>({
    execute: () => {
        void newProject();
    },
    describe: () => ({ label: 'New project' }),
    undoable: false,
});

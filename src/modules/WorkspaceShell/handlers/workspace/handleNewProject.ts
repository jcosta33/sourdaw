import { newProject } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleNewProject = createHandler<'newProject'>({
    execute: async (_action, context) => {
        await newProject('Untitled Project', context?.runCommandTransition);
    },
    describe: () => ({ label: 'New project' }),
    undoable: false,
});

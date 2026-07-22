import { saveProject } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleSaveProject = createHandler<'saveProject'>({
    execute: () => {
        // Fire-and-forget: saveProject notifies the user itself on failure.
        void saveProject();
    },
    describe: () => ({ label: 'Save project' }),
    undoable: false,
});

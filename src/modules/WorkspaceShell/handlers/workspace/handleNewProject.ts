import { newProject, saveProjectBeforeReplacement } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleNewProject = createHandler<'newProject'>({
    execute: () => {
        void (async () => {
            // No production dispatcher reaches this action today (the palette
            // and menu guard their own routes), but any future dispatcher must
            // not replace a project whose pre-switch save failed or resolved
            // still dirty (issue #3694).
            if (!(await saveProjectBeforeReplacement())) {
                return;
            }
            void newProject();
        })();
    },
    describe: () => ({ label: 'New project' }),
    undoable: false,
});

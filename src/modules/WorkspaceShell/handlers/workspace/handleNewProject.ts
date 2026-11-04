import { newProject, pendingProjectReplacements, saveProjectBeforeReplacement } from '#/modules/Project/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleNewProject = createHandler<'newProject'>({
    execute: () => {
        const isStillChosen = pendingProjectReplacements.capture();
        void (async () => {
            // No production dispatcher reaches this action today (the palette
            // and menu guard their own routes), but any future dispatcher must
            // not replace a project whose pre-switch save failed or resolved
            // still dirty (issue #3694) unless the user chose Don't Save, nor
            // one the user chose to stay in by choosing its Recent entry
            // meanwhile.
            const outgoingProject = await saveProjectBeforeReplacement();
            if (outgoingProject === 'stay' || !isStillChosen()) {
                return;
            }
            void newProject(undefined, { outgoingProject, shouldProceed: isStillChosen });
        })();
    },
    describe: () => ({ label: 'New project' }),
    undoable: false,
});

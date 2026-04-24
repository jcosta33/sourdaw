import { renameSection } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRenameSection = createHandler<'renameSection'>({
    execute: (alpha) => {
        renameSection(alpha.payload.sectionId, alpha.payload.name);
    },
    describe: (alpha) => ({ label: `Rename section to "${alpha.payload.name}"` }),
    undoable: true,
});

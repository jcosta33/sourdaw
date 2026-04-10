import { createHandler } from '#/helpers/createHandler';
import { renameSection } from '#/modules/Arrangement';

export const handleRenameSection = createHandler<'renameSection'>({
    execute: (a) => {
        renameSection(a.payload.sectionId, a.payload.name);
    },
    describe: (a) => ({ label: `Rename section to "${a.payload.name}"` }),
    undoable: true,
});

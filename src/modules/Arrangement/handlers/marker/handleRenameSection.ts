import { createHandler } from '#/utils/createHandler';

import { renameSection } from '../../useCases/marker/sectionOperations/renameSection';

export const handleRenameSection = createHandler<'renameSection'>({
    execute: (action) => {
        renameSection(action.payload.sectionId, action.payload.name);
    },
    describe: (action) => ({ label: `Rename section to "${action.payload.name}"` }),
    undoable: true,
});

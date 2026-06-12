import { createHandler } from '#/utils/createHandler';

import { removeSection } from '../../useCases/marker/sectionOperations/removeSection';

export const handleRemoveSection = createHandler<'removeSection'>({
    execute: (action) => {
        removeSection(action.payload.sectionId);
    },
    describe: () => ({ label: 'Remove section' }),
    undoable: true,
});

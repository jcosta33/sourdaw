import { createHandler } from '#/utils/createHandler';
import { removeSection } from '#/modules/Arrangement/useCases';

export const handleRemoveSection = createHandler<'removeSection'>({
    execute: (a) => {
        removeSection(a.payload.sectionId);
    },
    describe: () => ({ label: 'Remove section' }),
    undoable: true,
});

import { removeSection } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRemoveSection = createHandler<'removeSection'>({
    execute: (a) => {
        removeSection(a.payload.sectionId);
    },
    describe: () => ({ label: 'Remove section' }),
    undoable: true,
});

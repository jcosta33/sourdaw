import { removeSection } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRemoveSection = createHandler<'removeSection'>({
    execute: (alpha) => {
        removeSection(alpha.payload.sectionId);
    },
    describe: () => ({ label: 'Remove section' }),
    undoable: true,
});

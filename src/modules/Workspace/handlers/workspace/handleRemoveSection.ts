import { createHandler } from '#/helpers/createHandler';
import { removeSection } from '#/modules/Arrangement';

export const handleRemoveSection = createHandler<'removeSection'>({
    execute: (a) => {
        removeSection(a.payload.sectionId);
    },
    describe: () => ({ label: 'Remove section' }),
    undoable: true,
});

import { addSection } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAddSection = createHandler<'addSection'>({
    execute: (alpha) => {
        addSection(alpha.payload.startBeat, alpha.payload.endBeat, alpha.payload.name);
    },
    describe: (alpha) => ({ label: `Add section "${alpha.payload.name}"` }),
    undoable: true,
});

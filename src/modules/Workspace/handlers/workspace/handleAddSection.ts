import { addSection } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAddSection = createHandler<'addSection'>({
    execute: (a) => {
        addSection(a.payload.startBeat, a.payload.endBeat, a.payload.name);
    },
    describe: (a) => ({ label: `Add section "${a.payload.name}"` }),
    undoable: true,
});

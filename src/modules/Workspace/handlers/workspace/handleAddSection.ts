import { createHandler } from '#/helpers/createHandler';
import { addSection } from '#/modules/Arrangement';

export const handleAddSection = createHandler<'addSection'>({
    execute: (a) => {
        addSection(a.payload.startBeat, a.payload.endBeat, a.payload.name);
    },
    describe: (a) => ({ label: `Add section "${a.payload.name}"` }),
    undoable: true,
});

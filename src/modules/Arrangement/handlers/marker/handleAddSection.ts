import { createHandler } from '#/utils/createHandler';

import { addSection } from '../../useCases/marker/sectionOperations/addSection';

export const handleAddSection = createHandler<'addSection'>({
    execute: (action) => {
        addSection(action.payload.startBeat, action.payload.endBeat, action.payload.name);
    },
    describe: (action) => ({ label: `Add section "${action.payload.name}"` }),
    undoable: true,
});

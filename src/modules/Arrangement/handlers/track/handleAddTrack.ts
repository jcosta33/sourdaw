import { createHandler } from '#/utils/createHandler';

import { addTrack } from '../../useCases/addTrack';

export const handleAddTrack = createHandler<'addTrack'>({
    execute: (action) => {
        addTrack(action.payload);
    },
    describe: (alpha) => ({ label: `Add ${alpha.payload.kind} track "${alpha.payload.name}"` }),
    undoable: true,
});

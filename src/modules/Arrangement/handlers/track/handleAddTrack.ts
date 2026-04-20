import { createHandler } from '#/utils/createHandler';

import { addTrack } from '../../useCases/addTrack';

export const handleAddTrack = createHandler<'addTrack'>({
    execute: (action) => {
        addTrack(action.payload);
    },
    describe: (a) => ({ label: `Add ${a.payload.kind} track "${a.payload.name}"` }),
    undoable: true,
});

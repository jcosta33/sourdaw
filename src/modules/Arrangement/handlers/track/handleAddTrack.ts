import { addTrack } from '../../useCases/addTrack';
import { createHandler } from '#/utils/createHandler';

export const handleAddTrack = createHandler<'addTrack'>({
    execute: (action) => {
        addTrack(action.payload);
    },
    describe: (a) => ({ label: `Add ${a.payload.kind} track "${a.payload.name}"` }),
    undoable: true,
});

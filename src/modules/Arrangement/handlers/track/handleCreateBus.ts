import { addTrack } from '../../useCases/addTrack';
import { createHandler } from '#/helpers/createHandler';

export const handleCreateBus = createHandler<'createBus'>({
    execute: (action) => {
        addTrack({ name: action.payload.name, kind: 'bus' });
    },
    describe: (a) => ({ label: `Create bus "${a.payload.name}"` }),
    undoable: true,
});

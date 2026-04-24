import { createHandler } from '#/utils/createHandler';

import { addTrack } from '../../useCases/addTrack';

export const handleCreateBus = createHandler<'createBus'>({
    execute: (action) => {
        addTrack({ name: action.payload.name, kind: 'bus' });
    },
    describe: (alpha) => ({ label: `Create bus "${alpha.payload.name}"` }),
    undoable: true,
});

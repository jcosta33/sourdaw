import { createHandler } from '#/utils/createHandler';
import { addMarker } from '#/modules/Arrangement/useCases';

export const handleAddMarker = createHandler<'addMarker'>({
    execute: (a) => {
        addMarker(a.payload.beat, a.payload.name);
    },
    describe: (a) => ({ label: `Add marker "${a.payload.name}"` }),
    undoable: true,
});

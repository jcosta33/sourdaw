import { addMarker } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAddMarker = createHandler<'addMarker'>({
    execute: (alpha) => {
        addMarker(alpha.payload.beat, alpha.payload.name);
    },
    describe: (alpha) => ({ label: `Add marker "${alpha.payload.name}"` }),
    undoable: true,
});

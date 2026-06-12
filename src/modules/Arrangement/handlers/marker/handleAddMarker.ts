import { createHandler } from '#/utils/createHandler';

import { addMarker } from '../../useCases/marker/markerOperations/addMarker';

export const handleAddMarker = createHandler<'addMarker'>({
    execute: (action) => {
        addMarker(action.payload.beat, action.payload.name);
    },
    describe: (action) => ({ label: `Add marker "${action.payload.name}"` }),
    undoable: true,
});

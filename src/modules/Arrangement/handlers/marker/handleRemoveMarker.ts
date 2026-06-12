import { createHandler } from '#/utils/createHandler';

import { removeMarker } from '../../useCases/marker/markerOperations/removeMarker';

export const handleRemoveMarker = createHandler<'removeMarker'>({
    execute: (action) => {
        removeMarker(action.payload.markerId);
    },
    describe: () => ({ label: 'Remove marker' }),
    undoable: true,
});

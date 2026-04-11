import { createHandler } from '#/helpers/createHandler';
import { removeMarker } from '#/modules/Arrangement/useCases';

export const handleRemoveMarker = createHandler<'removeMarker'>({
    execute: (a) => {
        removeMarker(a.payload.markerId);
    },
    describe: () => ({ label: 'Remove marker' }),
    undoable: true,
});

import { removeMarker } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRemoveMarker = createHandler<'removeMarker'>({
    execute: (a) => {
        removeMarker(a.payload.markerId);
    },
    describe: () => ({ label: 'Remove marker' }),
    undoable: true,
});

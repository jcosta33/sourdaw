import { removeMarker } from '#/modules/Arrangement/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleRemoveMarker = createHandler<'removeMarker'>({
    execute: (alpha) => {
        removeMarker(alpha.payload.markerId);
    },
    describe: () => ({ label: 'Remove marker' }),
    undoable: true,
});

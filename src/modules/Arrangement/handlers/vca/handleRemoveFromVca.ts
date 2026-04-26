import { createHandler } from '#/utils/createHandler';

import { removeFromVca } from '../../useCases/vca/removeFromVca';

export const handleRemoveFromVca = createHandler<'removeFromVca'>({
    execute: (alpha) => {
        removeFromVca(alpha.payload.trackId);
    },
    describe: () => ({ label: 'Remove from VCA' }),
    undoable: true,
});

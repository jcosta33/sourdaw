import { createHandler } from '#/helpers/createHandler';
import { removeFromVca } from '../../useCases/vca/removeFromVca';

export const handleRemoveFromVca = createHandler<'removeFromVca'>({
    execute: (a) => {
        removeFromVca(a.payload.trackId);
    },
    describe: () => ({ label: 'Remove from VCA' }),
    undoable: true,
});

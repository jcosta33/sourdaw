import { createHandler } from '#/utils/createHandler';

import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { removeFromVca } from '../../useCases/vca/removeFromVca';

export const handleRemoveFromVca = createHandler<'removeFromVca'>({
    execute: (alpha) => {
        const written = removeFromVca(alpha.payload.trackId);
        if (!written) {
            return { status: 'no-write' };
        }
        return { status: 'written' };
    },
    describe: () => ({
        label: 'Remove from VCA',
        inverseAction: { type: 'restoreLegacyVcaState', payload: captureLegacyVcaState() },
    }),
    undoable: true,
});

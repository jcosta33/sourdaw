import { createHandler } from '#/utils/createHandler';

import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { restoreLegacyVcaState } from '../../useCases/vca/restoreLegacyVcaState';

export const handleRestoreLegacyVcaState = createHandler<'restoreLegacyVcaState'>({
    execute: (action) => {
        const written = restoreLegacyVcaState(action.payload);
        if (!written) {
            return { status: 'no-write' };
        }
        return { status: 'written' };
    },
    describe: () => ({
        label: 'Restore Legacy VCA State',
        inverseAction: { type: 'restoreLegacyVcaState', payload: captureLegacyVcaState() },
    }),
    undoable: true,
});

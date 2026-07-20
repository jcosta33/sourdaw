import { createHandler } from '#/utils/createHandler';

import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { restoreLegacyVcaState } from '../../useCases/vca/restoreLegacyVcaState';

export const handleRestoreLegacyVcaState = createHandler<'restoreLegacyVcaState'>({
    execute: (action) => {
        const result = restoreLegacyVcaState(action.payload);
        if (result === 'conflict') {
            return { status: 'conflict' };
        }
        if (result === 'no-write') {
            return { status: 'no-write' };
        }
        return { status: 'written' };
    },
    describe: (action) => ({
        label: 'Restore Legacy VCA State',
        inverseAction: { type: 'restoreLegacyVcaState', payload: captureLegacyVcaState(action) },
    }),
    undoable: true,
});

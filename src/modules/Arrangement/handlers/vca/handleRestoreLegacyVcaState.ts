import { createHandler } from '#/utils/createHandler';

import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { restoreLegacyVcaState } from '../../useCases/vca/restoreLegacyVcaState';

import { toVcaGainExecutionResult } from './toVcaGainExecutionResult';

export const handleRestoreLegacyVcaState = createHandler<'restoreLegacyVcaState'>({
    execute: (action) => {
        const result = restoreLegacyVcaState(action.payload);
        if (result === 'conflict') {
            return { status: 'conflict' };
        }
        return toVcaGainExecutionResult({
            groupIds: action.payload.groupGains.map((patch) => patch.groupId),
            status: result,
        });
    },
    describe: (action) => ({
        label: 'Restore Legacy VCA State',
        inverseAction: { type: 'restoreLegacyVcaState', payload: captureLegacyVcaState(action) },
    }),
    undoable: true,
});

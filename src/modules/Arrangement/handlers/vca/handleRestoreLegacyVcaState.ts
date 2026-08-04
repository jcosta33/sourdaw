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
        const groupIds = [
            ...action.payload.groupGains.map((patch) => patch.groupId),
            ...action.payload.groupRows.map((patch) => patch.groupId),
        ];
        const trackIds = [
            ...action.payload.trackMemberships.map((patch) => patch.trackId),
            ...action.payload.groupMemberships.map((patch) => patch.trackId),
            ...action.payload.groupRows.flatMap((patch) => [
                ...(patch.expected?.group.trackIds ?? []),
                ...(patch.replacement?.group.trackIds ?? []),
            ]),
        ];
        return toVcaGainExecutionResult({
            groupIds,
            trackIds,
            status: result,
        });
    },
    describe: (action) => ({
        label: 'Restore Legacy VCA State',
        inverseAction: { type: 'restoreLegacyVcaState', payload: captureLegacyVcaState(action) },
    }),
    undoable: true,
});

import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { createVcaGroup } from '../../useCases/vca/createVcaGroup';
import { getVcaGroups } from '../../useCases/vca/getVcaGroups';

import { toVcaGainExecutionResult } from './toVcaGainExecutionResult';

type CreateVcaGroupAction = Extract<AppAction, { type: 'createVcaGroup' }>;

function ensureVcaGroupId(action: CreateVcaGroupAction): string {
    action.payload.vcaGroupId ??= `vca-${crypto.randomUUID().slice(0, 8)}`;
    return action.payload.vcaGroupId;
}

export const handleCreateVcaGroup = createHandler<'createVcaGroup'>({
    execute: (alpha) => {
        const groupId = ensureVcaGroupId(alpha);
        createVcaGroup(alpha.payload.name, alpha.payload.trackIds, groupId);
        return toVcaGainExecutionResult({
            groupIds: [groupId],
            trackIds: alpha.payload.trackIds,
            status: 'written',
        });
    },
    describe: (alpha) => {
        ensureVcaGroupId(alpha);
        const inversePayload = captureLegacyVcaState(alpha);
        const redoPayload = captureLegacyVcaState({ type: 'restoreLegacyVcaState', payload: inversePayload });
        return {
            label: 'Create VCA Group',
            inverseAction: { type: 'restoreLegacyVcaState', payload: inversePayload },
            redoAction: { type: 'restoreLegacyVcaState', payload: redoPayload },
        };
    },
    isNoop: (alpha) => getVcaGroups().some((group) => group.id === ensureVcaGroupId(alpha)),
    undoable: true,
});

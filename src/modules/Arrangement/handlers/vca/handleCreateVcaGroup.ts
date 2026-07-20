import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { captureLegacyVcaState } from '../../useCases/vca/captureLegacyVcaState';
import { createVcaGroup } from '../../useCases/vca/createVcaGroup';
import { getVcaGroups } from '../../useCases/vca/getVcaGroups';

type CreateVcaGroupAction = Extract<AppAction, { type: 'createVcaGroup' }>;

function ensureVcaGroupId(action: CreateVcaGroupAction): string {
    action.payload.vcaGroupId ??= `vca-${crypto.randomUUID().slice(0, 8)}`;
    return action.payload.vcaGroupId;
}

export const handleCreateVcaGroup = createHandler<'createVcaGroup'>({
    execute: (alpha) => {
        createVcaGroup(alpha.payload.name, alpha.payload.trackIds, ensureVcaGroupId(alpha));
    },
    describe: (alpha) => {
        ensureVcaGroupId(alpha);
        return {
            label: 'Create VCA Group',
            inverseAction: { type: 'restoreLegacyVcaState', payload: captureLegacyVcaState(alpha) },
        };
    },
    isNoop: (alpha) => getVcaGroups().some((group) => group.id === ensureVcaGroupId(alpha)),
    undoable: true,
});

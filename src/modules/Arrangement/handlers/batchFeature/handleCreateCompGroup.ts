import { createHandler } from '#/utils/createHandler';

import { groupCompingStore } from '../../stores/groupComping';
import { createCompGroup } from '../../useCases/groupComping/compGroupOperations/createCompGroup';

export const handleCreateCompGroup = createHandler<'createCompGroup'>({
    execute: (alpha) => {
        const created = createCompGroup(alpha.payload.name, alpha.payload.trackIds, alpha.payload.groupId);
        return { status: created ? 'written' : 'no-write' };
    },
    describe: (alpha) => {
        const label = 'Create Comp Group';
        const groupId = alpha.payload.groupId;
        // `groupId` is materialized before `describe` runs (see
        // `materializeCommandApplicationIds`). Its absence means the command layer never
        // assigned an id for this dispatch, so there is nothing for an inverse to name.
        if (!groupId) {
            return { label, inverseAction: null };
        }
        return {
            label,
            inverseAction: {
                type: 'discardCreatedCompGroup',
                payload: {
                    groupId,
                    // Creation always overwrites `activeGroupId` with the new group's id
                    // (see `createCompGroup`), so that is what the guard on undo expects
                    // to still find live before it removes anything.
                    expectedActiveGroupId: groupId,
                    // Captured live, before `execute` runs, so undo restores whatever was
                    // active immediately prior to this command rather than assuming none.
                    replacementActiveGroupId: groupCompingStore.value?.activeGroupId ?? null,
                },
            },
        };
    },
    undoable: true,
});

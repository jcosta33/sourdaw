import { createHandler } from '#/utils/createHandler';

import { groupCompingStore } from '../../stores/groupComping';

export const handleDiscardCreatedCompGroup = createHandler<'discardCreatedCompGroup'>({
    execute: (action) => {
        const state = groupCompingStore.value;
        const groupStillExists = state?.groups.some((group) => group.id === action.payload.groupId) ?? false;
        // Guarded the same way `restoreSoloSafe` guards its compare-and-swap: only remove
        // the group, and only hand `activeGroupId` back to the caller's replacement, while
        // live state still matches what this command's `execute` produced. Anything else —
        // the active group already changed, or the group itself is already gone — means
        // some other write landed in between, and blindly overwriting `activeGroupId` would
        // clobber it.
        if (!state || state.activeGroupId !== action.payload.expectedActiveGroupId || !groupStillExists) {
            return { status: 'conflict' };
        }
        groupCompingStore.set({
            ...state,
            groups: state.groups.filter((group) => group.id !== action.payload.groupId),
            activeGroupId: action.payload.replacementActiveGroupId,
        });
        return { status: 'written' };
    },
    describe: () => ({ label: 'Discard created comp group', inverseAction: null }),
    undoable: false,
});

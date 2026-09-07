import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { restoreVersion } from '../../useCases/versionControl/restoreVersion';

export const handleRestoreProjectVersion = createHandler<'restoreProjectVersion'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        // Missing, non-restorable, and foreign-owned versions all refuse
        // without mutating the active project or its version selection.
        const restored = restoreVersion(alpha.payload.versionId);
        if (!restored) {
            notifyUser('This version cannot be restored in the active project', 'error');
            return { status: 'no-write' as const };
        }
        return { status: 'written' as const };
    },
    // Not undoable: restoreSnapshot overwrites the stores with no captured
    // pre-state and describe() returns no inverseAction, so an undo entry could
    // only no-op. Marking it non-undoable keeps that no-op off the undo stack.
    undoable: false,
    describe: () => ({ label: 'Restore Project Version' }),
});

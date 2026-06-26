import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { restoreVersion } from '../../useCases/versionControl/restoreVersion';

export const handleRestoreProjectVersion = createHandler<'restoreProjectVersion'>({
    // eslint-disable-next-line @typescript-eslint/require-await -- handler interface requires async execute; this handler has no asynchronous operations
    execute: async (alpha) => {
        // restoreVersion returns false when the version is missing or has no
        // restorable payload (e.g. a version reloaded from localStorage, whose
        // snapshot was persisted empty). Surface that to the user instead of
        // silently no-op'ing.
        const restored = restoreVersion(alpha.payload.versionId);
        if (!restored) {
            notifyUser('This version has no restorable snapshot', 'error');
        }
    },
    // Not undoable: restoreSnapshot overwrites the stores with no captured
    // pre-state and describe() returns no inverseAction, so an undo entry could
    // only no-op. Marking it non-undoable keeps that no-op off the undo stack.
    undoable: false,
    describe: () => ({ label: 'Restore Project Version' }),
});

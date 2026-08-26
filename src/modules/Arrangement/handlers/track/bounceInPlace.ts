import { createHandler } from '#/utils/createHandler';

import { bounceInPlace } from '../../useCases/freezeBounce/bounceInPlace';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleBounceInPlace = createHandler<'bounceInPlace'>({
    execute: async (action) => {
        let fileUndoEntry: (() => void) | undefined;
        const didWrite = await bounceInPlace(action.payload.trackId, {
            deferUndoEntry: (file) => {
                fileUndoEntry = file;
            },
        });
        if (!fileUndoEntry) {
            // No bounce happened, or the caller owns the undo unit — nothing to pair.
            return toHandlerExecutionResult(didWrite);
        }
        const file = fileUndoEntry;
        // The callback entry is the only undo mechanism for this command
        // (`undoable: false` keeps `executeAppAction` out of history), and the
        // write it covers merely pends in the dispatching transaction while
        // `execute` runs. Filing from the deferred hooks keeps the pair
        // together in every outcome: a commit-time abort rolls the write back
        // and the hooks never run, so no phantom entry survives; an ambiguous
        // commit left the write durable, so its entry is filed there too.
        return {
            status: 'written',
            afterCommit: file,
            afterAmbiguousCommit: file,
        };
    },
    describe: () => ({ label: 'Bounce in place' }),
    undoable: false,
});

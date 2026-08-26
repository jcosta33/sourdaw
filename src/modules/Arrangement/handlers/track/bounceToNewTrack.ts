import { createHandler } from '#/utils/createHandler';

import { bounceToNewTrack } from '../../useCases/freezeBounce/bounceToNewTrack';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleBounceToNewTrack = createHandler<'bounceToNewTrack'>({
    execute: async (action) => {
        let fileUndoEntry: (() => void) | undefined;
        const didWrite = await bounceToNewTrack(action.payload.trackId, {
            deferUndoEntry: (file) => {
                fileUndoEntry = file;
            },
        });
        if (!fileUndoEntry) {
            return toHandlerExecutionResult(didWrite);
        }
        const file = fileUndoEntry;
        // Same pairing contract as `handleBounceInPlace`: the callback entry
        // files only once the dispatching transaction made the write durable,
        // so an aborted bounce leaves history clean instead of a step whose
        // redo resurrects the new track outside any transaction.
        return {
            status: 'written',
            afterCommit: file,
            afterAmbiguousCommit: file,
        };
    },
    describe: () => ({ label: 'Bounce to new track' }),
    undoable: false,
});

import { createHandler } from '#/utils/createHandler';

import { prepareTimeOperationStateRestore } from '../../useCases/timeOperations/prepareTimeOperationStateRestore';

/**
 * Guarded inverse and redo of `deleteTime`, `insertTime`, and `duplicateTimeRange`, in
 * both directions. None of the three is self-inverse — deleting time discards what it
 * shifted over, inserting time is position-dependent, duplicating a range would duplicate
 * again if simply replayed — so each forward handler hands this its own restore plan
 * instead of a counter-operation. Conflicts when the live project no longer matches the
 * plan's expected state. Only ever dispatched from the undo engine, so it is not itself
 * undoable — same as `restoreFreezeState`.
 */
export const handleRestoreTimeOperationState = createHandler<'restoreTimeOperationState'>({
    execute: (action) => {
        const restoration = prepareTimeOperationStateRestore(action.payload.plan);
        if (restoration.status !== 'ready') {
            return { status: 'conflict' };
        }
        if (!restoration.hasChanges) {
            return { status: 'no-write' };
        }
        return restoration.apply() ? { status: 'written' } : { status: 'conflict' };
    },
    describe: () => ({ label: 'Restore time operation state', inverseAction: null }),
    undoable: false,
});

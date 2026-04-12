import { createHandler } from '#/utils/createHandler';
import { restoreSnapshot } from '../../useCases/restoreSnapshot';

export const handleRestoreDsoSnapshot = createHandler<'restoreDsoSnapshot'>({
    execute: (action) => {
        restoreSnapshot(action.payload.bundle);
    },
    describe: () => ({ label: 'Restore DSO Snapshot' }),
    undoable: false,
});

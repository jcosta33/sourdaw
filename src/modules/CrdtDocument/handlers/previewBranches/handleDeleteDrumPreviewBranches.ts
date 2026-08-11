import { createHandler } from '#/utils/createHandler';

import { deleteDrumPreviewBranches } from '../../useCases/crdtBranching/deleteDrumPreviewBranches';

export const handleDeleteDrumPreviewBranches = createHandler<'deleteDrumPreviewBranches'>({
    execute: async (action) => {
        const deleted = await deleteDrumPreviewBranches(action);
        return { status: deleted ? 'written' : 'conflict' };
    },
    describe: () => ({ label: 'Delete three guarded drum preview branches' }),
    batchExecution: 'singleton',
    requiresAbortCompensation: false,
    undoable: false,
});

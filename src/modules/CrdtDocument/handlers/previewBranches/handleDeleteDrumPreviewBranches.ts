import { createHandler } from '#/utils/createHandler';

import { deleteDrumPreviewBranches } from '../../useCases/crdtBranching/deleteDrumPreviewBranches';

type CreateDeleteDrumPreviewBranchesHandlerInput = {
    canMutateBranchMetadata: () => boolean;
};

export function createDeleteDrumPreviewBranchesHandler({
    canMutateBranchMetadata,
}: CreateDeleteDrumPreviewBranchesHandlerInput) {
    return createHandler<'deleteDrumPreviewBranches'>({
        previewExecution: 'unsupported-external',
        execute: async (action) => {
            if (!canMutateBranchMetadata()) {
                return { status: 'conflict' };
            }
            const deleted = await deleteDrumPreviewBranches(action);
            return { status: deleted ? 'written' : 'conflict' };
        },
        describe: () => ({ label: 'Delete three guarded drum preview branches' }),
        batchExecution: 'singleton',
        requiresAbortCompensation: false,
        undoable: false,
    });
}

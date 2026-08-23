import { createHandler } from '#/utils/createHandler';

import { drumPreviewBranchDeletion } from '../../useCases/crdtBranching/deleteDrumPreviewBranches';

type CreateDeleteDrumPreviewBranchesHandlerInput = {
    canMutateBranchMetadata: () => boolean;
};

export function createDeleteDrumPreviewBranchesHandler({
    canMutateBranchMetadata,
}: CreateDeleteDrumPreviewBranchesHandlerInput) {
    return createHandler<'deleteDrumPreviewBranches'>({
        validate: drumPreviewBranchDeletion.canDelete,
        canReapplyAfterDivergence: drumPreviewBranchDeletion.isReplayGuarded,
        previewExecution: 'unsupported-external',
        execute: async (action) => {
            if (!canMutateBranchMetadata()) {
                return { status: 'conflict' };
            }
            const deleted = await drumPreviewBranchDeletion.execute(action);
            return { status: deleted ? 'written' : 'conflict' };
        },
        describe: () => ({ label: 'Delete three guarded drum preview branches' }),
        batchExecution: 'singleton',
        requiresAbortCompensation: false,
        undoable: false,
    });
}

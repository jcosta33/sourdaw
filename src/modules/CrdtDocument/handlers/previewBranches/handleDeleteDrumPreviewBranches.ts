import { createHandler } from '#/utils/createHandler';

import {
    deleteDrumPreviewBranches,
    drumPreviewBranchDeletionPolicy,
} from '../../useCases/crdtBranching/deleteDrumPreviewBranches';

type CreateDeleteDrumPreviewBranchesHandlerInput = {
    canMutateBranchMetadata: () => boolean;
};

export function createDeleteDrumPreviewBranchesHandler({
    canMutateBranchMetadata,
}: CreateDeleteDrumPreviewBranchesHandlerInput) {
    return createHandler<'deleteDrumPreviewBranches'>({
        canReapplyAfterDivergence: (action) =>
            canMutateBranchMetadata() && drumPreviewBranchDeletionPolicy.hasGuardedCompensation(action),
        validate: (action) => canMutateBranchMetadata() && drumPreviewBranchDeletionPolicy.canDelete(action),
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

import { createDrumPreviewBranchesHandler } from '../handlers/previewBranches/handleCreateDrumPreviewBranches';
import { createDeleteDrumPreviewBranchesHandler } from '../handlers/previewBranches/handleDeleteDrumPreviewBranches';

type GetDrumPreviewBranchHandlersInput = {
    canMutateBranchMetadata: () => boolean;
};

export function getDrumPreviewBranchHandlers(input: GetDrumPreviewBranchHandlersInput) {
    return {
        createDrumPreviewBranches: createDrumPreviewBranchesHandler(input),
        deleteDrumPreviewBranches: createDeleteDrumPreviewBranchesHandler(input),
    };
}

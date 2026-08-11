import { handleCreateDrumPreviewBranches } from '../handlers/previewBranches/handleCreateDrumPreviewBranches';
import { handleDeleteDrumPreviewBranches } from '../handlers/previewBranches/handleDeleteDrumPreviewBranches';

export function getDrumPreviewBranchHandlers() {
    return {
        createDrumPreviewBranches: handleCreateDrumPreviewBranches,
        deleteDrumPreviewBranches: handleDeleteDrumPreviewBranches,
    };
}

import { type AppAction } from '#/utils/handlerContract';

import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';

import { branchDocumentTransitionFence } from './branchDocumentTransitionFence';
import { deleteDrumPreviewBranches } from './deleteDrumPreviewBranches';

type DeleteDrumPreviewBranchesAction = Extract<AppAction, { type: 'deleteDrumPreviewBranches' }>;

export async function rollbackCreatedDrumPreviewBranches(action: DeleteDrumPreviewBranchesAction): Promise<void> {
    try {
        const branchIds = new Set(action.payload.branches.map(({ branchId }) => branchId));
        const rootDocIds = new Set(action.payload.branches.map(({ rootDocId }) => rootDocId));
        const hasCreatedRecord = branchStore.value?.branches.some(({ branchId }) => branchIds.has(branchId)) ?? false;
        const hasCreatedDocument = [...rootDocIds].some((rootDocId) => automergeRepository.hasDoc(rootDocId));
        if (!hasCreatedRecord && !hasCreatedDocument) {
            return;
        }
        if (await deleteDrumPreviewBranches(action)) {
            return;
        }
        throw new Error('Drum preview branch rollback conflicted; manual repair is required');
    } finally {
        branchDocumentTransitionFence.release(action.payload.ownerId, 'aborted');
    }
}

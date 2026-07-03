import { logger } from '#/infra/logger/appLogger';

import { createBranchError } from '../../errors/BranchError';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID } from '../../stores/branchStore';
import { compactProject } from '../compactProject';

/**
 * Delete a branch. Cannot delete the main branch or the active branch.
 */
export function deleteBranch(branchId: string): void {
    if (branchId === MAIN_BRANCH_ID) {
        throw createBranchError('Cannot delete the main branch');
    }

    const state = branchStore.value;
    if (!state) {
        return;
    }

    if (state.activeBranchId === branchId) {
        throw createBranchError('Cannot delete the active branch — switch to another branch first');
    }

    const branch = state.branches.find((b) => b.branchId === branchId);
    let removedDoc = false;
    if (branch) {
        automergeRepository.removeDoc(branch.rootDocId);
        removedDoc = true;
    }

    branchStore.set({
        ...state,
        branches: state.branches.filter((b) => b.branchId !== branchId),
    });

    // Drop the branch's bytes from IndexedDB. `removeDoc` only evicts the
    // in-memory doc; without persisting, `branch_<uuid>` survives in IDB until
    // the next compaction and a reload re-materialises the deleted branch.
    // `compactProject()` rewrites the full bundle from the (now reduced) set of
    // live docs, so the deleted branch's key is cleared. Fire-and-forget to keep
    // the synchronous signature the caller relies on; matches the persistence
    // convention used elsewhere (e.g. AutomergeSync.persistCrdtProject().catch).
    if (removedDoc) {
        void compactProject().catch((error) => {
            logger.warn('[deleteBranch] Failed to persist after branch delete:', error);
        });
    }
}

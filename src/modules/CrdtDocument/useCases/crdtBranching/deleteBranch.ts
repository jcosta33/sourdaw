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

    // Record the removal first, and evict the document only once it landed.
    //
    // The reverse order made a refused `localStorage` write destructive: the
    // document was already gone from the repository when the throw unwound, so
    // the branch was left listed but unopenable, and the compaction below —
    // the step that clears its bytes from IndexedDB — never ran.
    //
    // Deliberately the throwing `set` rather than `trySet`. Nothing is
    // destroyed yet at this line, so a throw is the correct answer and not a
    // half-applied delete: the adapter keeps the cached value when the write
    // fails, so the branch stays listed, `handleDelete` in `BranchManagerDialog`
    // catches it, and the user can try again. A branch whose removal cannot be
    // persisted is a branch that was not deleted. See #1557.
    branchStore.set({
        ...state,
        branches: state.branches.filter((b) => b.branchId !== branchId),
    });

    let removedDoc = false;
    if (branch) {
        automergeRepository.removeDoc(branch.rootDocId);
        removedDoc = true;
    }

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

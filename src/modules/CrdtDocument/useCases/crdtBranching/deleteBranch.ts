import { logger } from '#/infra/logger/appLogger';

import { createBranchError } from '../../errors/BranchError';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStateAuthority } from '../../repositories/branchStateAuthority';
import { branchStore, MAIN_BRANCH_ID } from '../../stores/branchStore';
import { compactProject } from '../compactProject';

/**
 * Delete a branch. Cannot delete the main branch or the active branch.
 */
export async function deleteBranch(branchId: string): Promise<void> {
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

    const expectedRevision = branchStateAuthority.captureRevision();
    const branch = state.branches.find((b) => b.branchId === branchId);

    // Record the removal first, and evict the document only once it landed.
    //
    // The reverse order made a refused durable write destructive: the document
    // was already gone from the repository when the throw unwound, so the
    // branch was left listed but unopenable, and the compaction below — the step
    // that clears its bytes from IndexedDB — never ran.
    //
    // A branch whose removal cannot be persisted is a branch that was not
    // deleted, so a refusal throws: nothing is destroyed at this line, the
    // branch stays listed, `handleDelete` in `BranchManagerDialog` catches it,
    // and the user can try again. See #1557.
    const committed = await branchStateAuthority.commit({
        expectedRevision,
        next: { ...state, branches: state.branches.filter((b) => b.branchId !== branchId) },
    });
    if (committed.status === 'refused') {
        throw createBranchError(`Branch deletion could not be persisted (${committed.reason})`);
    }

    let removedDoc = false;
    if (branch) {
        automergeRepository.removeDoc(branch.rootDocId);
        removedDoc = true;
    }

    // Drop the branch's bytes from IndexedDB. `removeDoc` only evicts the
    // in-memory doc; without persisting, `branch_<uuid>` survives in IDB until
    // the next compaction and a reload re-materialises the deleted branch.
    // `compactProject()` rewrites the full bundle from the (now reduced) set of
    // live docs, so the deleted branch's key is cleared. Fire-and-forget so the
    // caller is not held for persistence it cannot act on; matches the
    // persistence convention used elsewhere (e.g. AutomergeSync.persistCrdtProject().catch).
    if (removedDoc) {
        void compactProject().catch((error) => {
            logger.warn('[deleteBranch] Failed to persist after branch delete:', error);
        });
    }
}

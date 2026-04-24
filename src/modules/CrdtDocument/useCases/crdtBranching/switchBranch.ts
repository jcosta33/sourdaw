import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';
import { projectCrdtToStores } from '../projection/projectProjection';

/**
 * Switch to a different branch.
 */
export function switchBranch(branchId: string): void {
    const state = branchStore.value;
    if (!state) {
        return;
    }

    const branch = state.branches.find((b) => b.branchId === branchId);
    if (!branch) {
        throw createBranchError(`Branch not found: ${branchId}`);
    }

    // The branch's doc is already in the repository (loaded at startup or fork time).
    // We just need to tell AutomergeStorage which doc ID to use.
    // For now, we swap the root doc reference.
    const branchDoc = automergeRepository.getDoc(branch.rootDocId);
    if (!branchDoc) {
        throw createBranchError(`Branch document not found: ${branch.rootDocId}`);
    }

    // Swap root doc to point to the branch
    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, branchDoc);

    branchStore.set({ ...state, activeBranchId: branchId });
    projectCrdtToStores();
}

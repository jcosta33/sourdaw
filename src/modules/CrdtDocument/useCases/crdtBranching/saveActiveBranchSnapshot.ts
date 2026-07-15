import { clone as cloneDoc, type Doc } from '@automerge/automerge';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { type BranchStoreState } from '../../stores/branchStore';

type SaveActiveBranchSnapshotInput = {
    state: BranchStoreState;
    liveRoot: Doc<unknown>;
};

/** Snapshot the active root into a branch-owned document before replacing it. */
export function saveActiveBranchSnapshot({ state, liveRoot }: SaveActiveBranchSnapshotInput): BranchStoreState {
    const activeBranch = state.branches.find(({ branchId }) => branchId === state.activeBranchId);
    if (!activeBranch) {
        throw createBranchError(`Active branch not found: ${state.activeBranchId}`);
    }

    const backingDocId =
        activeBranch.rootDocId === DOC_PREFIX_ROOT ? `branch_${activeBranch.branchId}` : activeBranch.rootDocId;
    const snapshot = cloneDoc(liveRoot);
    if (automergeRepository.hasDoc(backingDocId)) {
        automergeRepository.replaceDoc(backingDocId, snapshot);
    } else {
        automergeRepository.insertDoc(backingDocId, snapshot);
    }

    if (backingDocId === activeBranch.rootDocId) {
        return state;
    }

    return {
        ...state,
        branches: state.branches.map((branch) =>
            branch.branchId === activeBranch.branchId ? { ...branch, rootDocId: backingDocId } : branch
        ),
    };
}

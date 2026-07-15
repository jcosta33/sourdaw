import { merge, clone as cloneDoc } from '@automerge/automerge';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';

import { runBranchLineageTransition } from './runBranchLineageTransition';

/**
 * Merge a source branch into the current (target) branch.
 *
 * The target is always the *active* branch. `DOC_PREFIX_ROOT` mirrors the active
 * branch's working document, but we resolve the active branch explicitly and
 * validate the source is a different branch before merging — otherwise, combined
 * with a mis-routed root slot, a merge could silently land in the wrong branch.
 */
export async function mergeBranch(sourceBranchId: string): Promise<void> {
    const state = branchStore.value;
    if (!state) {
        return;
    }

    const sourceBranch = state.branches.find((b) => b.branchId === sourceBranchId);
    if (!sourceBranch) {
        throw createBranchError(`Source branch not found: ${sourceBranchId}`);
    }

    const activeBranch = state.branches.find((b) => b.branchId === state.activeBranchId);
    if (!activeBranch) {
        throw createBranchError(`Active branch not found: ${state.activeBranchId}`);
    }

    if (sourceBranchId === state.activeBranchId) {
        throw createBranchError('Cannot merge a branch into itself');
    }

    flushAutomergeStorageWrites();
    const sourceDoc = automergeRepository.getDoc(sourceBranch.rootDocId);
    // The active branch's live document is the root slot, which mirrors it.
    const targetDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);

    if (!sourceDoc || !targetDoc) {
        throw createBranchError('Cannot merge: missing documents');
    }

    await runBranchLineageTransition({
        affectedDocIds: [DOC_PREFIX_ROOT, activeBranch.rootDocId],
        from: state.activeBranchId,
        previousState: state,
        to: state.activeBranchId,
        apply: () => {
            const merged = merge(targetDoc, sourceDoc);
            automergeRepository.replaceDoc(DOC_PREFIX_ROOT, merged);
            if (activeBranch.rootDocId !== DOC_PREFIX_ROOT) {
                automergeRepository.replaceDoc(activeBranch.rootDocId, cloneDoc(merged));
            }
            return { result: undefined };
        },
    });
}

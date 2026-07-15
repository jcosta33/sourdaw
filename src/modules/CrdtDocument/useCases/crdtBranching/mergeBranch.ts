import { merge, clone as cloneDoc } from '@automerge/automerge';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';
import { compactProject } from '../compactProject';
import { projectCrdtToStores } from '../projection/projectProjection';

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

    const sourceDoc = automergeRepository.getDoc(sourceBranch.rootDocId);
    // The active branch's live document is the root slot, which mirrors it.
    const targetDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);

    if (!sourceDoc || !targetDoc) {
        throw createBranchError('Cannot merge: missing documents');
    }

    const merged = merge(targetDoc, sourceDoc);
    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, merged);
    // Keep the active branch's own snapshot in sync with its merged working doc
    // so the merge survives a later switch away (unless the active branch is
    // backed directly by the root slot, i.e. main).
    if (activeBranch.rootDocId !== DOC_PREFIX_ROOT) {
        automergeRepository.replaceDoc(activeBranch.rootDocId, cloneDoc(merged));
    }

    // Queue the full snapshot behind any retained or in-flight persistence.
    await compactProject();

    projectCrdtToStores();
}

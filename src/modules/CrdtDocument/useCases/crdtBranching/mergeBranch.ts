import { merge } from '@automerge/automerge';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { saveAllToIdb } from '../../repositories/crdtPersistence/saveAllToIdb';
import { branchStore } from '../../stores/branchStore';
import { projectCrdtToStores } from '../projection/projectProjection';

/**
 * Merge a source branch into the current (target) branch.
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

    const sourceDoc = automergeRepository.getDoc(sourceBranch.rootDocId);
    const targetDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);

    if (!sourceDoc || !targetDoc) {
        throw createBranchError('Cannot merge: missing documents');
    }

    const merged = merge(targetDoc, sourceDoc);
    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, merged);

    // Persist merged state
    const bundle = automergeRepository.saveAll();
    await saveAllToIdb(bundle);

    projectCrdtToStores();
}

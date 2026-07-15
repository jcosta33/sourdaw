import { getHeads, clone as cloneDoc } from '@automerge/automerge';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, type BranchRecord } from '../../stores/branchStore';
import { compactProject } from '../compactProject';
import { projectCrdtToStores } from '../projection/projectProjection';

import { saveActiveBranchSnapshot } from './saveActiveBranchSnapshot';

/**
 * Fork the current project into a new branch.
 * Uses Automerge.clone() for a fast copy that shares history with the source.
 */
export async function forkProjectBranch(name: string, note = ''): Promise<string> {
    const state = branchStore.value;
    if (!state) {
        throw createBranchError('Branch store not initialized');
    }

    flushAutomergeStorageWrites();
    const sourceDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
    if (!sourceDoc) {
        throw createBranchError('No root document to fork');
    }

    const branchId = crypto.randomUUID();
    const branchDocId = `branch_${branchId}`;
    const heads = getHeads(sourceDoc).map(String);

    // The root slot is only the active working document. Snapshot the source
    // into its own backing slot before root is repointed at the fork.
    const forkedDoc = cloneDoc(sourceDoc);
    flushAutomergeStorageWrites();
    const stateWithSourceSnapshot = saveActiveBranchSnapshot({ state, liveRoot: sourceDoc });
    automergeRepository.insertDoc(branchDocId, forkedDoc);
    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, cloneDoc(forkedDoc));

    const record: BranchRecord = {
        branchId,
        name,
        rootDocId: branchDocId,
        sourceBranchId: state.activeBranchId,
        createdAt: Date.now(),
        createdFromHeads: heads,
        note,
    };

    branchStore.set({
        branches: [...stateWithSourceSnapshot.branches, record],
        activeBranchId: branchId,
    });

    // Queue the full snapshot behind any retained or in-flight persistence.
    await compactProject();

    // Hydrate stores from the forked branch
    projectCrdtToStores();

    return branchId;
}

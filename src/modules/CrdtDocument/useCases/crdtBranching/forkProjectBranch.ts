import { getHeads, clone as cloneDoc } from '@automerge/automerge';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { createBranchError } from '../../errors/BranchError';
import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore, type BranchRecord } from '../../stores/branchStore';

import { runBranchLineageTransition } from './runBranchLineageTransition';
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
    const activeBranch = state.branches.find(({ branchId: candidateId }) => candidateId === state.activeBranchId);
    if (!activeBranch) {
        throw createBranchError(`Active branch not found: ${state.activeBranchId}`);
    }
    const sourceBackingDocId =
        activeBranch.rootDocId === DOC_PREFIX_ROOT ? `branch_${activeBranch.branchId}` : activeBranch.rootDocId;

    const forkedDoc = cloneDoc(sourceDoc);
    return runBranchLineageTransition({
        affectedDocIds: [DOC_PREFIX_ROOT, sourceBackingDocId, branchDocId],
        from: state.activeBranchId,
        previousState: state,
        to: branchId,
        apply: () => {
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

            return {
                nextState: {
                    branches: [...stateWithSourceSnapshot.branches, record],
                    activeBranchId: branchId,
                },
                result: branchId,
            };
        },
    });
}

import { DOC_BRANCHES } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';

import { branchDocumentTransitionFence } from './branchDocumentTransitionFence';
import { type PreparedDrumPreviewBranches } from './prepareDrumPreviewBranches';
import { runBranchDocumentTransition } from './runBranchDocumentTransition';

export async function createDrumPreviewBranches(prepared: PreparedDrumPreviewBranches): Promise<() => void> {
    const previousState = branchStore.value;
    if (!previousState) {
        throw new Error('Branch store is unavailable');
    }
    const ownerId = prepared.action.payload.ownerId;
    const candidateDocIds = prepared.branches.map(({ record }) => record.rootDocId);
    branchDocumentTransitionFence.begin({ docIds: [...candidateDocIds, DOC_BRANCHES], ownerId });
    try {
        await runBranchDocumentTransition({
            affectedDocIds: candidateDocIds,
            previousState,
            transitionOwnerId: ownerId,
            apply: () => {
                for (const branch of prepared.branches) {
                    automergeRepository.insertDoc(branch.record.rootDocId, branch.doc);
                }
                return {
                    nextState: {
                        branches: [...previousState.branches, ...prepared.branches.map(({ record }) => record)],
                        activeBranchId: previousState.activeBranchId,
                    },
                    result: undefined,
                };
            },
        });
    } catch (error) {
        branchDocumentTransitionFence.release(ownerId, 'aborted');
        throw error;
    }

    let finalized = false;
    return () => {
        if (finalized) {
            return;
        }
        finalized = true;
        try {
            automergeRepository.publishDocumentChanges(candidateDocIds);
        } finally {
            branchDocumentTransitionFence.release(ownerId, 'committed');
        }
    };
}

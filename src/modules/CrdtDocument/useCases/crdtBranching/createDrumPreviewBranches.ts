import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';

import { type PreparedDrumPreviewBranches } from './prepareDrumPreviewBranches';
import { runBranchDocumentTransition } from './runBranchDocumentTransition';

export function createDrumPreviewBranches(prepared: PreparedDrumPreviewBranches): Promise<void> {
    const previousState = branchStore.value;
    if (!previousState) {
        return Promise.reject(new Error('Branch store is unavailable'));
    }
    return runBranchDocumentTransition({
        affectedDocIds: prepared.branches.map(({ record }) => record.rootDocId),
        previousState,
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
}

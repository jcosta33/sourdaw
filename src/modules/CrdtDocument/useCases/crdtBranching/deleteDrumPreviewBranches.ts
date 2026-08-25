import { type AppAction } from '#/utils/handlerContract';

import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';

import { runBranchDocumentTransition } from './runBranchDocumentTransition';

type DeleteDrumPreviewBranchesAction = Extract<AppAction, { type: 'deleteDrumPreviewBranches' }>;

type PreparedDrumPreviewBranchDeletion = {
    branchIds: ReadonlySet<string>;
    state: NonNullable<typeof branchStore.value>;
};

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasGuardedDrumPreviewBranchDeletion(action: DeleteDrumPreviewBranchesAction): boolean {
    const { branches } = action.payload;
    return !(
        action.payload.ownerId.length === 0 ||
        action.payload.expectedSourceBranchId.length === 0 ||
        branches.length !== 3 ||
        new Set(branches.map(({ branchId }) => branchId)).size !== 3 ||
        new Set(branches.map(({ rootDocId }) => rootDocId)).size !== 3 ||
        branches.some(
            ({ branchId, branchName, expectedHeads, rootDocId }) =>
                branchId.length === 0 ||
                branchName.length === 0 ||
                branchId === action.payload.expectedSourceBranchId ||
                rootDocId !== `branch_${branchId}` ||
                expectedHeads.length === 0 ||
                new Set(expectedHeads).size !== expectedHeads.length ||
                !arraysEqual(expectedHeads, [...expectedHeads].toSorted())
        )
    );
}

function prepareDrumPreviewBranchDeletion(
    action: DeleteDrumPreviewBranchesAction
): PreparedDrumPreviewBranchDeletion | null {
    if (!hasGuardedDrumPreviewBranchDeletion(action)) {
        return null;
    }
    const { branches } = action.payload;
    const state = branchStore.value;
    if (!state || state.activeBranchId !== action.payload.expectedSourceBranchId) {
        return null;
    }
    const branchIds = new Set(branches.map(({ branchId }) => branchId));
    for (const expected of branches) {
        const matches = state.branches.filter(({ branchId }) => branchId === expected.branchId);
        const documentOwners = state.branches.filter(({ rootDocId }) => rootDocId === expected.rootDocId);
        const record = matches[0];
        const heads = [...(automergeRepository.getHeads(expected.rootDocId) ?? [])].map(String).toSorted();
        if (
            matches.length !== 1 ||
            documentOwners.length !== 1 ||
            documentOwners[0]?.branchId !== expected.branchId ||
            !record ||
            record.name !== expected.branchName ||
            record.rootDocId !== expected.rootDocId ||
            record.sourceBranchId !== action.payload.expectedSourceBranchId ||
            record.note !== `agent-preview:${action.payload.ownerId}` ||
            !arraysEqual(heads, expected.expectedHeads)
        ) {
            return null;
        }
    }

    return { branchIds, state };
}

function canDeleteDrumPreviewBranches(action: DeleteDrumPreviewBranchesAction): boolean {
    return prepareDrumPreviewBranchDeletion(action) !== null;
}

export const drumPreviewBranchDeletionPolicy = {
    hasGuardedCompensation: hasGuardedDrumPreviewBranchDeletion,
    canDelete: canDeleteDrumPreviewBranches,
};

export function deleteDrumPreviewBranches(action: DeleteDrumPreviewBranchesAction): Promise<boolean> {
    const prepared = prepareDrumPreviewBranchDeletion(action);
    if (!prepared) {
        return Promise.resolve(false);
    }
    const { branches } = action.payload;
    const { branchIds, state } = prepared;

    return runBranchDocumentTransition({
        affectedDocIds: branches.map(({ rootDocId }) => rootDocId),
        previousState: state,
        transitionOwnerId: action.payload.ownerId,
        apply: () => {
            for (const branch of branches) {
                automergeRepository.removeDoc(branch.rootDocId);
            }
            return {
                nextState: {
                    branches: state.branches.filter(({ branchId }) => !branchIds.has(branchId)),
                    activeBranchId: state.activeBranchId,
                },
                result: true,
            };
        },
    });
}

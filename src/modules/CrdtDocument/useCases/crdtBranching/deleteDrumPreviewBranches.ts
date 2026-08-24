import { type AppAction } from '#/utils/handlerContract';

import { automergeRepository } from '../../repositories/automergeRepository';
import { branchStore } from '../../stores/branchStore';

import { runBranchDocumentTransition } from './runBranchDocumentTransition';

type DeleteDrumPreviewBranchesAction = Extract<AppAction, { type: 'deleteDrumPreviewBranches' }>;

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isDeleteDrumPreviewBranchesReplayGuarded(action: DeleteDrumPreviewBranchesAction): boolean {
    const { branches } = action.payload;
    return (
        action.payload.ownerId.length > 0 &&
        action.payload.expectedSourceBranchId.length > 0 &&
        branches.length === 3 &&
        new Set(branches.map(({ branchId }) => branchId)).size === 3 &&
        new Set(branches.map(({ rootDocId }) => rootDocId)).size === 3 &&
        branches.every(
            ({ branchId, branchName, expectedHeads, rootDocId }) =>
                branchId.length > 0 &&
                branchName.length > 0 &&
                rootDocId === `branch_${branchId}` &&
                expectedHeads.length > 0
        )
    );
}

function canDeleteDrumPreviewBranches(action: DeleteDrumPreviewBranchesAction): boolean {
    if (!isDeleteDrumPreviewBranchesReplayGuarded(action)) {
        return false;
    }
    const { branches } = action.payload;
    const state = branchStore.value;
    if (!state || state.activeBranchId !== action.payload.expectedSourceBranchId) {
        return false;
    }
    for (const expected of branches) {
        const matches = state.branches.filter(({ branchId }) => branchId === expected.branchId);
        const record = matches[0];
        const heads = [...(automergeRepository.getHeads(expected.rootDocId) ?? [])].map(String).toSorted();
        if (
            matches.length !== 1 ||
            !record ||
            record.name !== expected.branchName ||
            record.rootDocId !== expected.rootDocId ||
            record.sourceBranchId !== action.payload.expectedSourceBranchId ||
            record.note !== `agent-preview:${action.payload.ownerId}` ||
            !arraysEqual(heads, expected.expectedHeads)
        ) {
            return false;
        }
    }
    return true;
}

function deleteDrumPreviewBranches(action: DeleteDrumPreviewBranchesAction): Promise<boolean> {
    const { branches } = action.payload;
    if (!canDeleteDrumPreviewBranches(action)) {
        return Promise.resolve(false);
    }
    const state = branchStore.value;
    if (!state) {
        return Promise.resolve(false);
    }
    const branchIds = new Set(branches.map(({ branchId }) => branchId));
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

export const drumPreviewBranchDeletion = {
    canDelete: canDeleteDrumPreviewBranches,
    execute: deleteDrumPreviewBranches,
    isReplayGuarded: isDeleteDrumPreviewBranchesReplayGuarded,
} as const;

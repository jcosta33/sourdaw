import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID, type BranchRecord } from '../../../stores/branchStore';
import { createDeleteDrumPreviewBranchesHandler } from '../handleDeleteDrumPreviewBranches';

const ownerId = 'preview-owner';

function createCandidates(): BranchRecord[] {
    return ['a', 'b', 'c'].map((branchId, index) => {
        const rootDocId = `branch_${branchId}`;
        automergeRepository.createChildDoc(rootDocId);
        automergeRepository.changeDoc<Record<string, number>>(rootDocId, (draft) => {
            draft.order = index;
        });
        return {
            branchId,
            name: `Preview ${branchId.toUpperCase()}`,
            rootDocId,
            sourceBranchId: MAIN_BRANCH_ID,
            createdAt: index,
            createdFromHeads: [],
            note: `agent-preview:${ownerId}`,
        };
    });
}

function createAction(candidates: readonly BranchRecord[]): Extract<AppAction, { type: 'deleteDrumPreviewBranches' }> {
    return {
        type: 'deleteDrumPreviewBranches',
        payload: {
            ownerId,
            expectedSourceBranchId: MAIN_BRANCH_ID,
            branches: candidates.map(({ branchId, name: branchName, rootDocId }) => ({
                branchId,
                branchName,
                rootDocId,
                expectedHeads: [...(automergeRepository.getHeads(rootDocId) ?? [])].map(String).toSorted(),
            })),
        },
    };
}

describe('deleteDrumPreviewBranches handler', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('drum preview branches');
        branchStore.set({
            activeBranchId: MAIN_BRANCH_ID,
            branches: [
                {
                    branchId: MAIN_BRANCH_ID,
                    name: 'Main',
                    rootDocId: 'root',
                    sourceBranchId: null,
                    createdAt: 0,
                    createdFromHeads: [],
                    note: '',
                },
            ],
        });
    });

    afterEach(() => {
        automergeRepository.reset();
    });

    it('validates, replays, and removes exactly the three receipt-bound preview branches', async () => {
        const candidates = createCandidates();
        branchStore.set({ activeBranchId: MAIN_BRANCH_ID, branches: [branchStore.value!.branches[0]!, ...candidates] });
        const action = createAction(candidates);
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => true });

        expect(handler.validate(action, {})).toBe(true);
        expect(handler.canReapplyAfterDivergence?.(action)).toBe(true);
        await expect(handler.execute(action)).resolves.toEqual({ status: 'written' });
        expect(branchStore.value).toEqual({
            activeBranchId: MAIN_BRANCH_ID,
            branches: [
                {
                    branchId: MAIN_BRANCH_ID,
                    name: 'Main',
                    rootDocId: 'root',
                    sourceBranchId: null,
                    createdAt: 0,
                    createdFromHeads: [],
                    note: '',
                },
            ],
        });
        expect(automergeRepository.getDocIds().toSorted()).toEqual(['root']);
    });

    it.each([
        [
            'changed heads',
            (candidates: readonly BranchRecord[]) => {
                automergeRepository.changeDoc<Record<string, boolean>>(candidates[0]!.rootDocId, (draft) => {
                    draft.editedByCollaborator = true;
                });
            },
        ],
        [
            'changed metadata',
            (candidates: readonly BranchRecord[]) => {
                const candidate = candidates[1]!;
                branchStore.set({
                    activeBranchId: MAIN_BRANCH_ID,
                    branches: branchStore.value!.branches.map((branch) =>
                        branch.branchId === candidate.branchId ? { ...branch, name: 'Renamed preview' } : branch
                    ),
                });
            },
        ],
    ] as const)('conflicts without deleting branches when receipt-bound %s diverges', async (_label, diverge) => {
        const candidates = createCandidates();
        branchStore.set({ activeBranchId: MAIN_BRANCH_ID, branches: [branchStore.value!.branches[0]!, ...candidates] });
        const action = createAction(candidates);
        const handler = createDeleteDrumPreviewBranchesHandler({ canMutateBranchMetadata: () => true });

        diverge(candidates);

        expect(handler.validate(action, {})).toBe(false);
        expect(handler.canReapplyAfterDivergence?.(action)).toBe(true);
        await expect(handler.execute(action)).resolves.toEqual({ status: 'conflict' });
        expect(branchStore.value?.branches.map(({ branchId }) => branchId)).toEqual([MAIN_BRANCH_ID, 'a', 'b', 'c']);
        expect(automergeRepository.getDocIds().toSorted()).toEqual(['branch_a', 'branch_b', 'branch_c', 'root']);
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID } from '../../../stores/branchStore';
import { compactProject } from '../../compactProject';
import { waitForCrdtDocumentTransition } from '../../waitForCrdtDocumentTransition';
import { branchDocumentTransitionFence } from '../branchDocumentTransitionFence';
import { rollbackCreatedDrumPreviewBranches } from '../rollbackCreatedDrumPreviewBranches';
import { runBranchDocumentTransition } from '../runBranchDocumentTransition';

vi.mock('../../compactProject', () => ({
    compactProject: vi.fn(),
}));
vi.mock('../../loadCrdtProject', () => ({
    loadCrdtProject: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../projection/projectProjection', () => ({
    projectCrdtToStores: vi.fn(),
}));

const initialBranchState = {
    activeBranchId: MAIN_BRANCH_ID,
    branches: [
        {
            branchId: MAIN_BRANCH_ID,
            name: 'main',
            rootDocId: 'root',
            sourceBranchId: null,
            createdAt: 0,
            createdFromHeads: [],
            note: '',
        },
    ],
};

describe('runBranchDocumentTransition', () => {
    beforeEach(() => {
        vi.mocked(compactProject).mockReset().mockResolvedValue(undefined);
        automergeRepository.reset();
        automergeRepository.createProject('project');
        branchStore.set(structuredClone(initialBranchState));
    });

    it('rolls back every created document and branch record when compaction fails', async () => {
        vi.mocked(compactProject).mockRejectedValueOnce(new Error('compaction failed'));
        const candidateIds = ['candidate-1', 'candidate-2', 'candidate-3'];

        await expect(
            runBranchDocumentTransition({
                affectedDocIds: candidateIds,
                previousState: structuredClone(initialBranchState),
                apply: () => {
                    for (const candidateId of candidateIds) {
                        automergeRepository.createChildDoc(candidateId);
                    }
                    return {
                        nextState: {
                            activeBranchId: MAIN_BRANCH_ID,
                            branches: [
                                ...initialBranchState.branches,
                                ...candidateIds.map((candidateId) => ({
                                    branchId: candidateId,
                                    name: candidateId,
                                    rootDocId: candidateId,
                                    sourceBranchId: MAIN_BRANCH_ID,
                                    createdAt: 1,
                                    createdFromHeads: [],
                                    note: 'agent-preview:test',
                                })),
                            ],
                        },
                        result: true,
                    };
                },
            })
        ).rejects.toThrow('compaction failed');

        expect(automergeRepository.getDocIds().toSorted()).toEqual(['root']);
        expect(branchStore.value).toEqual(initialBranchState);
    });

    it('lets the owning abort remove fenced candidate documents and release deferred peer sync', async () => {
        const ownerId = 'preview-owner';
        const candidateIds = ['branch_candidate-1', 'branch_candidate-2', 'branch_candidate-3'];
        const candidateRecords = candidateIds.map((rootDocId, index) => {
            automergeRepository.createChildDoc(rootDocId);
            automergeRepository.changeDoc<Record<string, unknown>>(rootDocId, (draft) => {
                draft.candidate = index;
            });
            return {
                branchId: rootDocId.replace('branch_', ''),
                name: `Candidate ${String(index + 1)}`,
                rootDocId,
                sourceBranchId: MAIN_BRANCH_ID,
                createdAt: 1,
                createdFromHeads: [],
                note: `agent-preview:${ownerId}`,
            };
        });
        branchStore.set({
            ...initialBranchState,
            branches: [...initialBranchState.branches, ...candidateRecords],
        });
        const action = {
            type: 'deleteDrumPreviewBranches',
            payload: {
                ownerId,
                expectedSourceBranchId: MAIN_BRANCH_ID,
                branches: candidateRecords.map(({ branchId, name, rootDocId }) => ({
                    branchId,
                    branchName: name,
                    rootDocId,
                    expectedHeads: [...(automergeRepository.getHeads(rootDocId) ?? [])].map(String).toSorted(),
                })),
            },
        } satisfies Extract<AppAction, { type: 'deleteDrumPreviewBranches' }>;
        branchDocumentTransitionFence.begin({ docIds: candidateIds, ownerId });

        const transition = waitForCrdtDocumentTransition(candidateIds[0]!);
        expect(transition).not.toBeNull();
        await rollbackCreatedDrumPreviewBranches(action);

        await expect(transition).resolves.toBe('aborted');
        expect(automergeRepository.getDocIds().toSorted()).toEqual(['root']);
        expect(branchStore.value).toEqual(initialBranchState);
        expect(waitForCrdtDocumentTransition(candidateIds[0]!)).toBeNull();
    });
});

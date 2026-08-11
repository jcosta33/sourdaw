import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID } from '../../../stores/branchStore';
import { compactProject } from '../../compactProject';
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
});

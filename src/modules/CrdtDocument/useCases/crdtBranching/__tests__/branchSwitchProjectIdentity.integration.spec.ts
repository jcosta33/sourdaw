import { clone as cloneDoc, type Doc } from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore } from '../../../stores/branchStore';
import { captureProjectIdentity } from '../../captureProjectIdentity';
import { forkProjectBranch } from '../forkProjectBranch';
import { switchBranch } from '../switchBranch';

vi.mock('../../compactProject', () => ({ compactProject: vi.fn(() => Promise.resolve()) }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
}));
// `saveActiveBranchSnapshot` is synchronous and its returned state is spread
// into the branch store update inside the same tick, so the mock must return
// the real `BranchStoreState` shape synchronously, not a Promise. It also
// registers the active branch's own backing document the first time it goes
// inactive (forkProjectBranch depends on that for switchBranch's later
// `getDoc` lookup) but skips the identity-moving `replaceDoc` flush of an
// already-registered backing doc — that flush is what switchBranch's own call
// performs, and skipping it isolates the root swap at switchBranch.ts:76 as
// the sole identity move under test.
vi.mock('../saveActiveBranchSnapshot', async () => {
    const { automergeRepository: repository } = await import('../../../repositories/automergeRepository');
    type BranchState = { branches: { branchId: string; rootDocId: string }[]; activeBranchId: string };
    return {
        saveActiveBranchSnapshot: vi.fn(({ state, liveRoot }: { state: BranchState; liveRoot: Doc<unknown> }) => {
            const activeBranch = state.branches.find(({ branchId }) => branchId === state.activeBranchId);
            if (!activeBranch) {
                return state;
            }
            const backingDocId =
                activeBranch.rootDocId === 'root' ? `branch_${activeBranch.branchId}` : activeBranch.rootDocId;
            if (!repository.hasDoc(backingDocId)) {
                repository.insertDoc(backingDocId, cloneDoc(liveRoot));
            }
            if (backingDocId === activeBranch.rootDocId) {
                return state;
            }
            return {
                ...state,
                branches: state.branches.map((branch) =>
                    branch.branchId === activeBranch.branchId ? { ...branch, rootDocId: backingDocId } : branch
                ),
            };
        }),
    };
});

describe('branch switch moves project identity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        automergeRepository.reset();
        automergeRepository.createProject('branch identity test');
        branchStore.set({
            branches: [
                {
                    branchId: 'main',
                    name: 'Main',
                    rootDocId: 'root',
                    sourceBranchId: null,
                    createdAt: 1,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: 'main',
        });
    });

    it('moves when a branch switch replaces the root document', async () => {
        await forkProjectBranch('feature');
        const identityBeforeSwitch = captureProjectIdentity();
        const epochBeforeSwitch = automergeRepository.getDocumentIdentityEpoch();

        await switchBranch('main');

        // With the outgoing snapshot write mocked, the only identity move
        // inside switchBranch is the root swap at switchBranch.ts:76, so the
        // epoch advances by exactly one.
        expect(automergeRepository.getDocumentIdentityEpoch()).toBe(epochBeforeSwitch + 1);
        expect(captureProjectIdentity()).not.toBe(identityBeforeSwitch);
    });
});

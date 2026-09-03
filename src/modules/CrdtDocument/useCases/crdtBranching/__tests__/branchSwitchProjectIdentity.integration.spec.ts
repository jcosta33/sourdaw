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
        const initialIdentity = captureProjectIdentity();

        await forkProjectBranch('feature');
        const identityBeforeSwitch = captureProjectIdentity();
        const epochBeforeSwitch = automergeRepository.getDocumentIdentityEpoch();

        await switchBranch('main');

        // The fork alone already moves identity (branch snapshot + new branch +
        // root swap), so a plain "differs from the very first capture" check
        // would stay true even if switchBranch's own root swap stopped moving
        // it. `saveActiveBranchSnapshot` inside switchBranch's apply() also
        // writes the outgoing branch's snapshot and moves identity on its own,
        // so isolating the swap at switchBranch.ts:76 needs the exact epoch
        // delta across the switch call, not just "moved since the fork": that
        // delta is 2 here (the outgoing snapshot write, then the root swap)
        // when the swap uses `replaceDoc`, and only 1 if it stopped moving
        // identity.
        expect(captureProjectIdentity()).not.toBe(initialIdentity);
        expect(captureProjectIdentity()).not.toBe(identityBeforeSwitch);
        expect(automergeRepository.getDocumentIdentityEpoch()).toBe(epochBeforeSwitch + 2);
    });
});

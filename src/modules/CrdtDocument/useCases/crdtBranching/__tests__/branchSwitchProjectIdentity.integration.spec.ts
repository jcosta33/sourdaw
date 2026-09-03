import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOC_PREFIX_ROOT } from '../../../models/CrdtDocumentTypes';
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

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('moves when a branch switch replaces the root document', async () => {
        await forkProjectBranch('feature');
        const identityBeforeSwitch = captureProjectIdentity();
        const replaceDoc = vi.spyOn(automergeRepository, 'replaceDoc');

        await switchBranch('main');

        // The root swap at switchBranch.ts:76 is the identity-moving replacement
        // the AI batch's projectId reads; the outgoing snapshot write targets the
        // branch's backing doc, not the root, so the root-id filter isolates the
        // swap.
        expect(replaceDoc).toHaveBeenCalledWith(DOC_PREFIX_ROOT, expect.anything());
        expect(captureProjectIdentity()).not.toBe(identityBeforeSwitch);
    });
});

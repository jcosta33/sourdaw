import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { DOC_PREFIX_ROOT } from '../../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore } from '../../../stores/branchStore';
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
        // The real branch-state authority sequences every durable write on a
        // Web Lock, and jsdom ships no Web Locks API.
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
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
        vi.unstubAllGlobals();
        automergeRepository.reset();
    });

    it('moves when a branch switch replaces the root document', async () => {
        await forkProjectBranch('feature');

        // The outgoing snapshot write (saveActiveBranchSnapshot.ts:24) also calls
        // replaceDoc, on the branch's own backing doc, before switchBranch.ts:76
        // runs — so the epoch has to be read around the root call itself, not
        // taken as a single before/after snapshot around the whole switch.
        const original = automergeRepository.replaceDoc.bind(automergeRepository);
        const epochMoves: Array<{ id: string; before: number; after: number }> = [];
        vi.spyOn(automergeRepository, 'replaceDoc').mockImplementation((id, doc, tx) => {
            const before = automergeRepository.getDocumentIdentityEpoch();
            original(id, doc, tx);
            epochMoves.push({ id, before, after: automergeRepository.getDocumentIdentityEpoch() });
        });

        await switchBranch('main');

        const rootSwap = epochMoves.find(({ id }) => id === DOC_PREFIX_ROOT);
        expect(rootSwap).toBeDefined();
        if (!rootSwap) {
            throw new Error('Expected the root swap to be recorded');
        }
        expect(rootSwap.after).toBe(rootSwap.before + 1);
    });
});

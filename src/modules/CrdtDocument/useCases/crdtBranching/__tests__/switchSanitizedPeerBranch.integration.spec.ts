import { change, init, load } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStore } from '../../../stores/branchStore';
import { createCrdtDoc } from '../../createCrdtDoc';
import { replaceCrdtDoc } from '../../replaceCrdtDoc';
import { sanitizeIncomingCrdtDocument } from '../../sanitizeIncomingCrdtDocument';
import { switchBranch } from '../switchBranch';

vi.mock('../../compactProject', () => ({ compactProject: vi.fn(() => Promise.resolve()) }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
}));
type PeerBranchDocument = {
    actionHistory?: unknown;
};

describe('switchBranch sanitized peer branch integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        automergeRepository.reset();
        // The real branch-state authority sequences every durable write on a
        // Web Lock, and jsdom ships no Web Locks API.
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        createCrdtDoc('root');
        createCrdtDoc('branch_feat');
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
                {
                    branchId: 'feat',
                    name: 'Feature',
                    rootDocId: 'branch_feat',
                    sourceBranchId: 'main',
                    createdAt: 2,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: 'main',
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should expose and serialize only metadata after switching to a sanitized peer branch', async () => {
        const incoming_branch = change(init<PeerBranchDocument>(), (document) => {
            document.actionHistory = {
                entries: [
                    {
                        id: 'peer-entry',
                        label: 'Peer action',
                        actionKind: 'setTempo',
                        source: 'manual',
                        timestamp: 1,
                        reverted: false,
                        action: { type: 'setTempo' },
                        inverseAction: { type: 'setTempo' },
                    },
                ],
            };
        });
        replaceCrdtDoc({ id: 'branch_feat', doc: sanitizeIncomingCrdtDocument(incoming_branch) });

        await switchBranch('feat');

        expect(automergeRepository.getDoc<PeerBranchDocument>('root')?.actionHistory).toEqual({
            entries: [
                {
                    id: 'peer-entry',
                    label: 'Peer action',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 1,
                    reverted: false,
                },
            ],
        });
        const persisted_bundle = automergeRepository.saveAll();
        const persisted_root = persisted_bundle.get('root');
        if (!persisted_root) {
            throw new Error('Expected persisted root bytes after branch switch');
        }
        expect(load<PeerBranchDocument>(persisted_root).actionHistory).toEqual(
            automergeRepository.getDoc<PeerBranchDocument>('root')?.actionHistory
        );
    });
});

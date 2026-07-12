import { change, init, load } from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../../repositories/automergeRepository';
import { saveAllToIdb } from '../../../repositories/crdtPersistence/saveAllToIdb';
import { branchStore } from '../../../stores/branchStore';
import { createCrdtDoc } from '../../createCrdtDoc';
import { replaceCrdtDoc } from '../../replaceCrdtDoc';
import { sanitizeIncomingCrdtDocument } from '../../sanitizeIncomingCrdtDocument';
import { switchBranch } from '../switchBranch';

vi.mock('../../../repositories/crdtPersistence/saveAllToIdb', () => ({
    saveAllToIdb: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../repositories/crdtPersistence/clearIncrementalsFromIdb', () => ({
    clearIncrementalsFromIdb: vi.fn().mockResolvedValue(undefined),
}));

type PeerBranchDocument = {
    actionHistory?: unknown;
};

describe('switchBranch sanitized peer branch integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        automergeRepository.reset();
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

    it('should expose and persist only metadata after switching to a sanitized peer branch', async () => {
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

        switchBranch('feat');

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
        await vi.waitFor(() => expect(saveAllToIdb).toHaveBeenCalled());
        const persisted_bundle = vi.mocked(saveAllToIdb).mock.calls.at(-1)?.[0];
        const persisted_root = persisted_bundle?.get('root');
        if (!persisted_root) {
            throw new Error('Expected persisted root bytes after branch switch');
        }
        expect(load<PeerBranchDocument>(persisted_root).actionHistory).toEqual(
            automergeRepository.getDoc<PeerBranchDocument>('root')?.actionHistory
        );
    });
});

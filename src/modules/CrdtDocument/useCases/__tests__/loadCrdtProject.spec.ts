import { change, init, load, save, saveIncremental } from '@automerge/automerge';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadCrdtProject } from '../loadCrdtProject';

const mocks = vi.hoisted(() => ({
    loadAll: vi.fn(),
    getDoc: vi.fn(),
    replaceDoc: vi.fn(),
    loadAllFromIdb: vi.fn(),
    replaceAllInIdb: vi.fn(),
    branchStoreValue: { branches: [{ branchId: 'main', rootDocId: 'root' }], activeBranchId: 'main' } as {
        branches: { branchId: string; rootDocId: string }[];
        activeBranchId: string;
    } | null,
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        loadAll: mocks.loadAll,
        getDoc: mocks.getDoc,
        replaceDoc: mocks.replaceDoc,
    },
}));
vi.mock('../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.branchStoreValue };
    },
}));
vi.mock('../../repositories/crdtPersistence/loadAllFromIdb', () => ({ loadAllFromIdb: mocks.loadAllFromIdb }));
vi.mock('../../repositories/crdtPersistence/replaceAllInIdb', () => ({ replaceAllInIdb: mocks.replaceAllInIdb }));

describe('loadCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadAll.mockResolvedValue(true);
        mocks.replaceAllInIdb.mockResolvedValue(undefined);
        mocks.branchStoreValue = {
            branches: [{ branchId: 'main', rootDocId: 'root' }],
            activeBranchId: 'main',
        };
    });

    it('should load from IDB and update the repository', async () => {
        const mockBundle = new Map();
        mocks.loadAllFromIdb.mockResolvedValue(mockBundle);

        const can_activate = () => true;
        const result = await loadCrdtProject({ canActivate: can_activate });

        expect(result).toBe('loaded');
        expect(mocks.replaceAllInIdb).toHaveBeenCalledWith(mockBundle);
        expect(mocks.loadAll).toHaveBeenCalledWith(mockBundle, can_activate);
        expect(mocks.replaceAllInIdb.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadAll.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });

    it('should restore the last-active branch into the root slot', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.branchStoreValue = {
            branches: [
                { branchId: 'main', rootDocId: 'root' },
                { branchId: 'feat', rootDocId: 'branch_feat' },
            ],
            activeBranchId: 'feat',
        };
        const branchDoc = { tag: 'feat-doc' };
        mocks.getDoc.mockImplementation((id: string) => (id === 'branch_feat' ? branchDoc : undefined));

        await loadCrdtProject({ canActivate: () => true });

        // Regression: reopening must land on the active branch, not whatever doc
        // last occupied the root slot.
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', branchDoc);
    });

    it('should leave the root slot untouched when the active branch is main', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.branchStoreValue = {
            branches: [{ branchId: 'main', rootDocId: 'root' }],
            activeBranchId: 'main',
        };

        await loadCrdtProject({ canActivate: () => true });

        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('should stay on the root slot when the active branch doc is absent', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.branchStoreValue = {
            branches: [
                { branchId: 'main', rootDocId: 'root' },
                { branchId: 'feat', rootDocId: 'branch_feat' },
            ],
            activeBranchId: 'feat',
        };
        mocks.getDoc.mockReturnValue(undefined);

        const result = await loadCrdtProject({ canActivate: () => true });

        expect(result).toBe('loaded');
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('should not activate a bundle after transition ownership is lost', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        let current = true;
        mocks.loadAll.mockImplementation(async () => {
            current = false;
            return false;
        });

        const result = await loadCrdtProject({ canActivate: () => current });

        expect(result).toBe('stale');
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('should abort activation when durable sanitized replacement fails', async () => {
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.replaceAllInIdb.mockRejectedValueOnce(new Error('idb write failed'));

        const result = await loadCrdtProject({ canActivate: () => true });

        expect(result).toBe('sanitization-failed');
        expect(mocks.loadAll).not.toHaveBeenCalled();
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
    });

    it('should durably rewrite normalized metadata bytes and remove superseded incrementals before activation', async () => {
        let document = init<{ actionHistory?: unknown }>();
        const base_bytes = save(document);
        document = change(document, (draft) => {
            draft.actionHistory = {
                entries: [
                    {
                        id: 'persisted-entry',
                        label: 'Persisted action',
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
        const bundle = new Map([
            ['root', base_bytes],
            ['root:incremental:000001', saveIncremental(document)],
        ]);
        mocks.loadAllFromIdb.mockResolvedValue(bundle);

        await loadCrdtProject({ canActivate: () => true });

        const persisted_bundle = mocks.replaceAllInIdb.mock.calls[0]?.[0];
        expect(persisted_bundle?.has('root:incremental:000001')).toBe(false);
        const persisted_root = persisted_bundle?.get('root');
        if (!persisted_root) {
            throw new Error('Expected normalized persisted root bytes');
        }
        expect(load<{ actionHistory?: unknown }>(persisted_root).actionHistory).toEqual({
            entries: [
                {
                    id: 'persisted-entry',
                    label: 'Persisted action',
                    actionKind: 'setTempo',
                    source: 'manual',
                    timestamp: 1,
                    reverted: false,
                },
            ],
        });
        expect(mocks.replaceAllInIdb.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadAll.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });
});

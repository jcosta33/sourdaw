import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadCrdtProject } from '../loadCrdtProject';

const mocks = vi.hoisted(() => ({
    loadAll: vi.fn<(input: { bundle: Map<string, Uint8Array>; shouldCommit?: () => boolean }) => Promise<boolean>>(),
    loadPersistenceSnapshotFromIdb: vi.fn(),
    setCrdtPersistenceAuthority: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        loadAll: mocks.loadAll,
    },
}));
vi.mock('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb', () => ({
    loadPersistenceSnapshotFromIdb: mocks.loadPersistenceSnapshotFromIdb,
}));
vi.mock('../crdtPersistenceQueue', () => ({
    setCrdtPersistenceAuthority: mocks.setCrdtPersistenceAuthority,
}));

describe('loadCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadAll.mockResolvedValue(true);
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1 },
            bundle: null,
        });
    });

    it('should load from IDB and update the repository', async () => {
        const mockBundle = new Map();
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1 },
            bundle: mockBundle,
        });

        const result = await loadCrdtProject();

        expect(result).toBe(true);
        expect(mocks.loadAll).toHaveBeenCalledWith({ bundle: mockBundle, shouldCommit: undefined });
    });

    it('returns absence from one empty persistence read without committing', async () => {
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue(null);

        await expect(loadCrdtProject()).resolves.toBe(false);

        expect(mocks.loadAll).not.toHaveBeenCalled();
    });

    it('does not adopt empty persistence authority after commit is superseded', async () => {
        const shouldCommit = vi.fn(() => false);

        await expect(loadCrdtProject({ shouldCommit })).resolves.toBe(false);

        expect(mocks.loadAll).not.toHaveBeenCalled();
        expect(mocks.setCrdtPersistenceAuthority).not.toHaveBeenCalled();
    });

    it('keeps the loaded root authoritative over an older active-branch snapshot', async () => {
        const loadedRoot = new Uint8Array([1, 2, 3]);
        const olderBranchSnapshot = new Uint8Array([1]);
        const bundle = new Map([
            ['root', loadedRoot],
            ['branch_feat', olderBranchSnapshot],
        ]);
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1 },
            bundle,
        });

        await expect(loadCrdtProject()).resolves.toBe(true);

        expect(mocks.loadAll).toHaveBeenCalledWith({ bundle, shouldCommit: undefined });
    });

    it('does not restore branch state when repository commit is canceled', async () => {
        const should_commit = vi.fn(() => false);
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1 },
            bundle: new Map(),
        });
        mocks.loadAll.mockResolvedValue(false);

        const result = await loadCrdtProject({ shouldCommit: should_commit });

        expect(result).toBe(false);
        const loadInput = mocks.loadAll.mock.calls[0]?.[0];
        expect(loadInput?.bundle).toBeInstanceOf(Map);
        expect(loadInput?.shouldCommit).toBe(should_commit);
    });

    it('does not restore branch state when authority is revoked after repository commit', async () => {
        let shouldCommit = true;
        mocks.loadPersistenceSnapshotFromIdb.mockResolvedValue({
            authority: { epoch: 'test-project', revision: 1 },
            bundle: new Map(),
        });
        mocks.loadAll.mockImplementationOnce(() => {
            shouldCommit = false;
            return Promise.resolve(true);
        });

        const result = await loadCrdtProject({ shouldCommit: () => shouldCommit });

        expect(result).toBe(false);
    });
});

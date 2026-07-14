import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadCrdtProject } from '../loadCrdtProject';

const mocks = vi.hoisted(() => ({
    loadAll: vi.fn<(input: { bundle: Map<string, Uint8Array>; shouldCommit?: () => boolean }) => Promise<boolean>>(),
    loadAllFromIdb: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        loadAll: mocks.loadAll,
    },
}));
vi.mock('../../repositories/crdtPersistence/loadAllFromIdb', () => ({ loadAllFromIdb: mocks.loadAllFromIdb }));

describe('loadCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loadAll.mockResolvedValue(true);
    });

    it('should load from IDB and update the repository', async () => {
        const mockBundle = new Map();
        mocks.loadAllFromIdb.mockResolvedValue(mockBundle);

        const result = await loadCrdtProject();

        expect(result).toBe(true);
        expect(mocks.loadAll).toHaveBeenCalledWith({ bundle: mockBundle, shouldCommit: undefined });
    });

    it('keeps the loaded root authoritative over an older active-branch snapshot', async () => {
        const loadedRoot = new Uint8Array([1, 2, 3]);
        const olderBranchSnapshot = new Uint8Array([1]);
        const bundle = new Map([
            ['root', loadedRoot],
            ['branch_feat', olderBranchSnapshot],
        ]);
        mocks.loadAllFromIdb.mockResolvedValue(bundle);

        await expect(loadCrdtProject()).resolves.toBe(true);

        expect(mocks.loadAll).toHaveBeenCalledWith({ bundle, shouldCommit: undefined });
    });

    it('does not restore branch state when repository commit is canceled', async () => {
        const should_commit = vi.fn(() => false);
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.loadAll.mockResolvedValue(false);

        const result = await loadCrdtProject({ shouldCommit: should_commit });

        expect(result).toBe(false);
        const loadInput = mocks.loadAll.mock.calls[0]?.[0];
        expect(loadInput?.bundle).toBeInstanceOf(Map);
        expect(loadInput?.shouldCommit).toBe(should_commit);
    });

    it('does not restore branch state when authority is revoked after repository commit', async () => {
        let shouldCommit = true;
        mocks.loadAllFromIdb.mockResolvedValue(new Map());
        mocks.loadAll.mockImplementationOnce(() => {
            shouldCommit = false;
            return Promise.resolve(true);
        });

        const result = await loadCrdtProject({ shouldCommit: () => shouldCommit });

        expect(result).toBe(false);
    });
});

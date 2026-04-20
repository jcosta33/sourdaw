import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCrdtProject, loadCrdtProject, persistCrdtProject, compactProject } from '../crdtProjectLifecycle';

const mocks = vi.hoisted(() => ({
    createProject: vi.fn(),
    loadAll: vi.fn(),
    saveAll: vi.fn(() => new Map()),
    saveDocIncremental: vi.fn(),
    loadAllFromIdb: vi.fn(),
    saveAllToIdb: vi.fn(),
    saveIncrementalToIdb: vi.fn(),
    clearIncrementalsFromIdb: vi.fn(),
    hasCrdtDocsInIdb: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        createProject: mocks.createProject,
        loadAll: mocks.loadAll,
        saveAll: mocks.saveAll,
        saveDocIncremental: mocks.saveDocIncremental,
    },
}));

vi.mock('../../repositories/crdtPersistence/loadAllFromIdb', () => ({ loadAllFromIdb: mocks.loadAllFromIdb }));
vi.mock('../../repositories/crdtPersistence/saveAllToIdb', () => ({ saveAllToIdb: mocks.saveAllToIdb }));
vi.mock('../../repositories/crdtPersistence/saveIncrementalToIdb', () => ({
    saveIncrementalToIdb: mocks.saveIncrementalToIdb,
}));
vi.mock('../../repositories/crdtPersistence/clearIncrementalsFromIdb', () => ({
    clearIncrementalsFromIdb: mocks.clearIncrementalsFromIdb,
}));
vi.mock('../../repositories/crdtPersistence/hasCrdtDocsInIdb', () => ({ hasCrdtDocsInIdb: mocks.hasCrdtDocsInIdb }));

describe('crdtProjectLifecycle', () => {
    beforeEach(() => vi.clearAllMocks());

    it('createCrdtProject initializes repo and compacts', async () => {
        await createCrdtProject('New Project');
        expect(mocks.createProject).toHaveBeenCalledWith('New Project');
        expect(mocks.saveAllToIdb).toHaveBeenCalled();
    });

    it('loadCrdtProject loads from IDB and updates repo', async () => {
        const mockBundle = new Map();
        mocks.loadAllFromIdb.mockResolvedValue(mockBundle);

        const result = await loadCrdtProject();

        expect(result).toBe(true);
        expect(mocks.loadAll).toHaveBeenCalledWith(mockBundle);
    });

    it('persistCrdtProject saves incremental chunk to IDB', async () => {
        mocks.saveDocIncremental.mockReturnValue(new Uint8Array([1, 2, 3]));

        await persistCrdtProject();

        expect(mocks.saveIncrementalToIdb).toHaveBeenCalledWith('root', expect.any(Uint8Array));
    });

    it('compactProject writes full bundle and clears incrementals', async () => {
        const mockBundle = new Map([['doc1', new Uint8Array([4, 5, 6])]]);
        mocks.saveAll.mockReturnValue(mockBundle);

        await compactProject();

        expect(mocks.saveAllToIdb).toHaveBeenCalledWith(mockBundle);
        expect(mocks.clearIncrementalsFromIdb).toHaveBeenCalledWith('root');
    });
});

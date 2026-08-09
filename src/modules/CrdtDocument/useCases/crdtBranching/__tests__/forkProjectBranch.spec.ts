import { describe, it, expect, vi, beforeEach } from 'vitest';

import { forkProjectBranch } from '../forkProjectBranch';

const SOURCE_DOC = { tag: 'source' };
const CLONED_DOC = { tag: 'cloned' };

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    getDoc: vi.fn(),
    hasDoc: vi.fn(() => false),
    insertDoc: vi.fn(),
    replaceDoc: vi.fn(),
    removeDoc: vi.fn(),
    storeValue: { branches: [{ branchId: 'main', rootDocId: 'root' }], activeBranchId: 'main' },
    storeSet: vi.fn(),
    // The rollback path writes with trySet: it runs after the documents have
    // been restored, where a throw would skip the projection that puts the
    // stores back in step with them. See #1557.
    storeTrySet: vi.fn(() => true),
    compactProject: vi.fn(),
    loadCrdtProject: vi.fn(() => Promise.resolve(true)),
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
    projectCrdtToStores: vi.fn(),
    clone: vi.fn(() => CLONED_DOC),
    getHeads: vi.fn(() => ['h1']),
}));

vi.mock('@automerge/automerge', () => ({
    clone: mocks.clone,
    getHeads: mocks.getHeads,
}));
vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites,
}));
vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: {
        getDoc: mocks.getDoc,
        hasDoc: mocks.hasDoc,
        insertDoc: mocks.insertDoc,
        replaceDoc: mocks.replaceDoc,
        removeDoc: mocks.removeDoc,
    },
}));
vi.mock('../../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.storeValue, set: mocks.storeSet, trySet: mocks.storeTrySet };
    },
}));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('../../loadCrdtProject', () => ({ loadCrdtProject: mocks.loadCrdtProject }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: mocks.runCrdtPersistenceOperation,
}));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mocks.projectCrdtToStores }));

describe('forkProjectBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.flushAutomergeStorageWrites.mockImplementation(() => undefined);
        mocks.clone.mockReturnValue(CLONED_DOC);
        mocks.getHeads.mockReturnValue(['h1']);
        mocks.getDoc.mockImplementation((id: string) => (id === 'root' ? SOURCE_DOC : undefined));
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.loadCrdtProject.mockResolvedValue(true);
    });

    it('repoints the root slot at the forked doc so post-fork edits route to the new branch', async () => {
        await forkProjectBranch('feature');

        // Regression: fork must replaceDoc('root', <forked>) — without it, edits
        // keep landing in the source branch while the UI shows the new branch.
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', CLONED_DOC);

        // The fork is also stored under its own branch slot.
        expect(mocks.insertDoc).toHaveBeenCalledWith('branch_main', CLONED_DOC);
        const insertCall = mocks.insertDoc.mock.calls.find(([id]) => id !== 'branch_main');
        if (!insertCall) {
            throw new Error('Expected the fork branch backing insert');
        }
        expect(insertCall[0]).toMatch(/^branch_/);
        expect(insertCall[1]).toBe(CLONED_DOC);
    });

    it('flushes deferred storage before reading the source and replacing the root slot', async () => {
        const order: string[] = [];
        mocks.flushAutomergeStorageWrites.mockImplementation(() => {
            order.push('flush');
        });
        mocks.getDoc.mockImplementation((id: string) => {
            order.push(`get:${id}`);
            return id === 'root' ? SOURCE_DOC : undefined;
        });
        mocks.replaceDoc.mockImplementation(() => {
            order.push('replace');
        });

        await forkProjectBranch('feature');

        expect(mocks.flushAutomergeStorageWrites).toHaveBeenCalledTimes(2);
        expect(order[0]).toBe('flush');
        expect(order.indexOf('flush', 1)).toBeLessThan(order.indexOf('replace'));
    });

    it('marks the new branch active and persists', async () => {
        const branchId = await forkProjectBranch('feature');

        expect(mocks.runCrdtPersistenceOperation).toHaveBeenCalledWith({
            type: 'root-lineage-transition',
            from: 'main',
            to: branchId,
        });
        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ activeBranchId: branchId }));
        expect(mocks.compactProject).toHaveBeenCalledOnce();
        expect(mocks.projectCrdtToStores).toHaveBeenCalled();
    });

    it('rejects and restores the source branch when persistence fails', async () => {
        const error = new Error('persist failed');
        mocks.compactProject.mockRejectedValueOnce(error);

        await expect(forkProjectBranch('feature')).rejects.toBe(error);
        expect(mocks.loadCrdtProject).toHaveBeenCalledOnce();
        expect(mocks.storeTrySet).toHaveBeenLastCalledWith(mocks.storeValue);
        expect(mocks.removeDoc).toHaveBeenCalledTimes(2);
    });

    it('throws when there is no root document to fork', async () => {
        mocks.getDoc.mockReturnValue(undefined);
        await expect(forkProjectBranch('feature')).rejects.toThrow(/No root document/);
    });
});

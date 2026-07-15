import { describe, it, expect, vi, beforeEach } from 'vitest';

import { forkProjectBranch } from '../forkProjectBranch';

const SOURCE_DOC = { tag: 'source' };
const CLONED_DOC = { tag: 'cloned' };

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    getDoc: vi.fn(),
    insertDoc: vi.fn(),
    replaceDoc: vi.fn(),
    storeValue: { branches: [{ branchId: 'main', rootDocId: 'root' }], activeBranchId: 'main' },
    storeSet: vi.fn(),
    compactProject: vi.fn(),
    projectCrdtToStores: vi.fn(),
    clone: vi.fn(() => CLONED_DOC),
    getHeads: vi.fn(() => ['h1']),
}));

vi.mock('@automerge/automerge', () => ({
    clone: mocks.clone,
    getHeads: mocks.getHeads,
}));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites,
}));
vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: {
        getDoc: mocks.getDoc,
        insertDoc: mocks.insertDoc,
        replaceDoc: mocks.replaceDoc,
    },
}));
vi.mock('../../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.storeValue, set: mocks.storeSet };
    },
}));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mocks.projectCrdtToStores }));

describe('forkProjectBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.flushAutomergeStorageWrites.mockImplementation(() => undefined);
        mocks.clone.mockReturnValue(CLONED_DOC);
        mocks.getHeads.mockReturnValue(['h1']);
        mocks.getDoc.mockImplementation((id: string) => (id === 'root' ? SOURCE_DOC : undefined));
        mocks.compactProject.mockResolvedValue(undefined);
    });

    it('repoints the root slot at the forked doc so post-fork edits route to the new branch', async () => {
        await forkProjectBranch('feature');

        // Regression: fork must replaceDoc('root', <forked>) — without it, edits
        // keep landing in the source branch while the UI shows the new branch.
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', CLONED_DOC);

        // The fork is also stored under its own branch slot.
        const insertCall = mocks.insertDoc.mock.calls[0];
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

        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ activeBranchId: branchId }));
        expect(mocks.compactProject).toHaveBeenCalledOnce();
        expect(mocks.projectCrdtToStores).toHaveBeenCalled();
    });

    it('propagates queued persistence errors before projecting the fork', async () => {
        const error = new Error('persist failed');
        mocks.compactProject.mockRejectedValueOnce(error);

        await expect(forkProjectBranch('feature')).rejects.toBe(error);
        expect(mocks.projectCrdtToStores).not.toHaveBeenCalled();
    });

    it('throws when there is no root document to fork', async () => {
        mocks.getDoc.mockReturnValue(undefined);
        await expect(forkProjectBranch('feature')).rejects.toThrow(/No root document/);
    });
});

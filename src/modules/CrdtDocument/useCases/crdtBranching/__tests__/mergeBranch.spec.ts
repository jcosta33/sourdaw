import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mergeBranch } from '../mergeBranch';

const SOURCE_DOC = { tag: 'source' };
const TARGET_DOC = { tag: 'target' };
const ACTIVE_SNAPSHOT = { tag: 'active-snapshot' };
const MERGED_DOC = { tag: 'merged' };

const docs: Record<string, unknown> = {};

const mocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
    hasDoc: vi.fn(),
    insertDoc: vi.fn(),
    replaceDoc: vi.fn(),
    removeDoc: vi.fn(),
    storeValue: {
        branches: [
            { branchId: 'main', rootDocId: 'root' },
            { branchId: 'feat', rootDocId: 'branch_feat' },
            { branchId: 'src', rootDocId: 'branch_src' },
        ],
        activeBranchId: 'feat',
    },
    compactProject: vi.fn(),
    flushAutomergeStorageWrites: vi.fn(),
    loadCrdtProject: vi.fn(() => Promise.resolve(true)),
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
    projectCrdtToStores: vi.fn(),
    merge: vi.fn(() => MERGED_DOC),
    clone: vi.fn((doc: unknown) => structuredClone(doc)),
    storeSet: vi.fn(),
    // The rollback path writes with trySet: it runs after the documents have
    // been restored, where a throw would skip the projection that puts the
    // stores back in step with them. See #1557.
    storeTrySet: vi.fn(() => true),
}));

vi.mock('@automerge/automerge', () => ({ merge: mocks.merge, clone: mocks.clone }));
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

describe('mergeBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        docs.root = TARGET_DOC;
        docs.branch_feat = ACTIVE_SNAPSHOT;
        docs.branch_src = SOURCE_DOC;
        mocks.getDoc.mockImplementation((id: string) => docs[id]);
        mocks.hasDoc.mockImplementation((id: string) => id in docs);
        mocks.insertDoc.mockImplementation((id: string, doc: unknown) => {
            docs[id] = doc;
        });
        mocks.replaceDoc.mockImplementation((id: string, doc: unknown) => {
            docs[id] = doc;
        });
        mocks.removeDoc.mockImplementation((id: string) => {
            delete docs[id];
        });
        mocks.merge.mockReturnValue(MERGED_DOC);
        mocks.flushAutomergeStorageWrites.mockImplementation(() => undefined);
        mocks.storeValue.activeBranchId = 'feat';
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.loadCrdtProject.mockResolvedValue(true);
    });

    it('merges the source into the active branch (root slot) and refreshes its snapshot', async () => {
        await mergeBranch('src');

        // Regression: merge resolves the active branch (feat) and merges source
        // into the root slot, then mirrors the result back to branch_feat so the
        // merge survives a later switch away.
        expect(mocks.merge).toHaveBeenCalledWith(TARGET_DOC, SOURCE_DOC);
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', MERGED_DOC);
        const snapshot = mocks.replaceDoc.mock.calls.find((c) => c[0] === 'branch_feat');
        expect(snapshot).toBeDefined();
        expect(mocks.compactProject).toHaveBeenCalledOnce();
    });

    it('flushes deferred root writes before reading the active branch', async () => {
        const flushedTarget = { tag: 'flushed-target' };
        mocks.flushAutomergeStorageWrites.mockImplementationOnce(() => {
            docs.root = flushedTarget;
        });

        await mergeBranch('src');

        expect(mocks.merge).toHaveBeenCalledWith(flushedTarget, SOURCE_DOC);
    });

    it('rejects and restores the active branch when persistence fails', async () => {
        const error = new Error('persist failed');
        mocks.compactProject.mockRejectedValueOnce(error);

        await expect(mergeBranch('src')).rejects.toBe(error);
        expect(mocks.loadCrdtProject).toHaveBeenCalledOnce();
        expect(mocks.storeTrySet).toHaveBeenLastCalledWith(mocks.storeValue);
        expect(docs.root).toEqual(TARGET_DOC);
        expect(docs.branch_feat).toEqual(ACTIVE_SNAPSHOT);
    });

    it('rejects merging a branch into itself', async () => {
        mocks.storeValue.activeBranchId = 'src';
        await expect(mergeBranch('src')).rejects.toThrow(/into itself/);
        expect(mocks.merge).not.toHaveBeenCalled();
    });

    it('throws when the source branch is unknown', async () => {
        await expect(mergeBranch('ghost')).rejects.toThrow(/Source branch not found/);
    });

    it('throws when a document is missing', async () => {
        docs.branch_src = undefined;
        await expect(mergeBranch('src')).rejects.toThrow(/missing documents/);
    });
});

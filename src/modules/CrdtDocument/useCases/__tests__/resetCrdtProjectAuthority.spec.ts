import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { resetCrdtProjectAuthority } from '../resetCrdtProjectAuthority';

const mocks = vi.hoisted(() => {
    const rootDocs: Record<string, unknown>[] = [];
    const docs = new Map<string, Record<string, unknown>>();
    function createProjectImplementation(_: string): string {
        const root: Record<string, unknown> = {};
        rootDocs.push(root);
        docs.clear();
        docs.set('root', root);
        return 'root';
    }

    return {
        branchStoreSet: vi.fn(),
        rootDocs,
        docs,
        createProjectImplementation,
        createProject: vi.fn(createProjectImplementation),
    };
});

vi.mock('../../stores/branchStore', () => ({
    branchStore: { set: mocks.branchStoreSet },
    MAIN_BRANCH_ID: 'main',
}));
vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: { createProject: mocks.createProject },
}));

describe('resetCrdtProjectAuthority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.branchStoreSet.mockReset();
        mocks.createProject.mockReset();
        mocks.createProject.mockImplementation(mocks.createProjectImplementation);
        mocks.rootDocs.length = 0;
        mocks.docs.clear();
        const initialRoot = {};
        mocks.rootDocs.push(initialRoot);
        mocks.docs.set('root', initialRoot);
        configureAutomergeStoragePort({
            getDoc: (docId) => mocks.docs.get(docId),
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => mocks.docs.has(docId),
            mutateDoc: ({ docId, changeFn }) => {
                const doc = mocks.docs.get(docId);
                if (!doc) {
                    throw new Error(`Missing test document: ${docId}`);
                }
                changeFn(doc);
            },
        });
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 42)
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('replaces the document authority before publishing the new branch state', () => {
        resetCrdtProjectAuthority('Imported');

        expect(mocks.branchStoreSet).toHaveBeenCalledWith({
            branches: [expect.objectContaining({ branchId: 'main', rootDocId: 'root', sourceBranchId: null })],
            activeBranchId: 'main',
        });
        expect(mocks.createProject.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.branchStoreSet.mock.invocationCallOrder[0]!
        );
        expect(mocks.createProject).toHaveBeenCalledWith('Imported');
    });

    it('drains old deferred writes before replacing authority and sends new branch state to the new root', () => {
        const oldRootStorage = createAutomergeStorage<{ value: string }>('root', 'oldProject');
        const newBranchStorage = createAutomergeStorage<{ value: string }>('root', 'newBranch');
        const oldRoot = mocks.rootDocs[0];

        oldRootStorage.set({ value: 'old' });
        mocks.branchStoreSet.mockImplementationOnce(() => {
            newBranchStorage.set({ value: 'new' });
        });

        resetCrdtProjectAuthority('New Project');
        const newRoot = mocks.rootDocs[1];

        flushAutomergeStorageWrites();

        expect(oldRoot).toEqual({ oldProject: { value: 'old' } });
        expect(newRoot).toEqual({ newBranch: { value: 'new' } });
    });
});

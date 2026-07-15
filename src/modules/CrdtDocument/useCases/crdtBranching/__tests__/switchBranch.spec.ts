import { describe, it, expect, vi, beforeEach } from 'vitest';

import { switchBranch } from '../switchBranch';

const ROOT_LIVE_DOC = { tag: 'root-live' };
const TARGET_SNAPSHOT = { tag: 'target-snap' };

const docs: Record<string, unknown> = {};

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    getDoc: vi.fn(),
    hasDoc: vi.fn(),
    insertDoc: vi.fn(),
    replaceDoc: vi.fn(),
    storeValue: {
        branches: [
            { branchId: 'main', rootDocId: 'root' },
            { branchId: 'feat', rootDocId: 'branch_feat' },
            { branchId: 'other', rootDocId: 'branch_other' },
        ],
        activeBranchId: 'feat',
    },
    storeSet:
        vi.fn<(state: { branches: Array<{ branchId: string; rootDocId: string }>; activeBranchId: string }) => void>(),
    projectCrdtToStores: vi.fn(),
    compactProject: vi.fn(() => Promise.resolve()),
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
    clone: vi.fn((d: unknown) => ({ tag: 'cloned', from: d })),
}));

vi.mock('@automerge/automerge', () => ({ clone: mocks.clone }));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites,
}));
vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: {
        getDoc: mocks.getDoc,
        hasDoc: mocks.hasDoc,
        insertDoc: mocks.insertDoc,
        replaceDoc: mocks.replaceDoc,
    },
}));
vi.mock('../../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.storeValue, set: mocks.storeSet };
    },
}));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mocks.projectCrdtToStores }));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: mocks.runCrdtPersistenceOperation,
}));

describe('switchBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.flushAutomergeStorageWrites.mockImplementation(() => undefined);
        docs.root = ROOT_LIVE_DOC;
        docs.branch_feat = { tag: 'feature-snap' };
        docs.branch_other = TARGET_SNAPSHOT;
        mocks.getDoc.mockImplementation((id: string) => docs[id]);
        mocks.hasDoc.mockImplementation((id: string) => id in docs);
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.storeValue.activeBranchId = 'feat';
    });

    it('writes the outgoing branch live edits back to its snapshot before swapping', () => {
        switchBranch('other');

        // Regression: the outgoing branch (feat) is not main, so its live root
        // edits must be flushed into branch_feat — otherwise they are lost/aliased.
        const writeback = mocks.replaceDoc.mock.calls.find((c) => c[0] === 'branch_feat');
        expect(writeback).toBeDefined();

        // Then the target's snapshot is swapped into the root slot.
        const swap = mocks.replaceDoc.mock.calls.find((c) => c[0] === 'root');
        expect(swap).toBeDefined();
    });

    it('flushes deferred storage before reading the target and swapping the root slot', () => {
        const order: string[] = [];
        mocks.flushAutomergeStorageWrites.mockImplementation(() => {
            order.push('flush');
        });
        mocks.getDoc.mockImplementation((id: string) => {
            order.push(`get:${id}`);
            return docs[id];
        });
        mocks.replaceDoc.mockImplementation((id: string) => {
            order.push(`replace:${id}`);
        });
        mocks.insertDoc.mockImplementation((id: string) => {
            order.push(`insert:${id}`);
        });

        switchBranch('other');

        expect(mocks.flushAutomergeStorageWrites).toHaveBeenCalledTimes(2);
        expect(order[0]).toBe('flush');
        expect(order.indexOf('flush', 1)).toBeLessThan(order.indexOf('replace:root'));
    });

    it('migrates an outgoing legacy main branch to an independent backing document', () => {
        mocks.storeValue.activeBranchId = 'main';
        switchBranch('other');

        expect(mocks.insertDoc).toHaveBeenCalledWith('branch_main', expect.anything());
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', expect.anything());
        const nextState = mocks.storeSet.mock.calls[0]?.[0];
        expect(nextState?.activeBranchId).toBe('other');
        expect(nextState?.branches).toContainEqual(
            expect.objectContaining({ branchId: 'main', rootDocId: 'branch_main' })
        );
    });

    it('persists after the swap', () => {
        switchBranch('other');
        expect(mocks.runCrdtPersistenceOperation).toHaveBeenCalledWith({
            type: 'root-lineage-transition',
            from: 'feat',
            to: 'other',
        });
        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ activeBranchId: 'other' }));
        expect(mocks.compactProject).toHaveBeenCalled();
    });

    it('is a no-op when switching to the already-active branch', () => {
        switchBranch('feat');
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
        expect(mocks.storeSet).not.toHaveBeenCalled();
    });

    it('throws when the target branch does not exist', () => {
        expect(() => switchBranch('ghost')).toThrow(/Branch not found/);
    });
});

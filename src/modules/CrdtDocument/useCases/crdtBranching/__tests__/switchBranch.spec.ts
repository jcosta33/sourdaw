import { describe, it, expect, vi, beforeEach } from 'vitest';

import { switchBranch } from '../switchBranch';

const ROOT_LIVE_DOC = { tag: 'root-live' };
const TARGET_SNAPSHOT = { tag: 'target-snap' };

const docs: Record<string, unknown> = {};

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    getDoc: vi.fn(),
    replaceDoc: vi.fn(),
    storeValue: {
        branches: [
            { branchId: 'main', rootDocId: 'root' },
            { branchId: 'feat', rootDocId: 'branch_feat' },
            { branchId: 'other', rootDocId: 'branch_other' },
        ],
        activeBranchId: 'feat',
    },
    storeSet: vi.fn(),
    projectCrdtToStores: vi.fn(),
    compactProject: vi.fn(() => Promise.resolve()),
    clone: vi.fn((d: unknown) => ({ tag: 'cloned', from: d })),
}));

vi.mock('@automerge/automerge', () => ({ clone: mocks.clone }));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: mocks.flushAutomergeStorageWrites,
}));
vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: { getDoc: mocks.getDoc, replaceDoc: mocks.replaceDoc },
}));
vi.mock('../../../stores/branchStore', () => ({
    get branchStore() {
        return { value: mocks.storeValue, set: mocks.storeSet };
    },
}));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mocks.projectCrdtToStores }));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));

describe('switchBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.flushAutomergeStorageWrites.mockImplementation(() => undefined);
        docs.root = ROOT_LIVE_DOC;
        docs.branch_other = TARGET_SNAPSHOT;
        mocks.getDoc.mockImplementation((id: string) => docs[id]);
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

        switchBranch('other');

        expect(mocks.flushAutomergeStorageWrites).toHaveBeenCalledTimes(2);
        expect(order[0]).toBe('flush');
        expect(order.indexOf('flush', 1)).toBeLessThan(order.indexOf('replace:root'));
    });

    it('does not write back when the outgoing branch is main (root-backed)', () => {
        mocks.storeValue.activeBranchId = 'main';
        switchBranch('other');

        // main.rootDocId === 'root', so no separate snapshot writeback.
        const writeback = mocks.replaceDoc.mock.calls.find(
            (c) => typeof c[0] === 'string' && c[0].startsWith('branch_') && c[0] !== 'branch_other'
        );
        expect(writeback).toBeUndefined();
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', expect.anything());
    });

    it('persists after the swap', () => {
        switchBranch('other');
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

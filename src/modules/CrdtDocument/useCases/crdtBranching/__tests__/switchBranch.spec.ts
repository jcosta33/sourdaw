import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type captureUndoHistory } from '#/modules/Command/useCases';

import { switchBranch } from '../switchBranch';

// Derived from the public callable's own return type rather than importing
// Command's private UndoEntry model across the module boundary.
type UndoSnapshot = ReturnType<typeof captureUndoHistory>;
type UndoSnapshotEntry = UndoSnapshot['past'][number];

const ROOT_LIVE_DOC = { tag: 'root-live' };
const FEATURE_SNAPSHOT = { tag: 'feature-snap' };
const TARGET_SNAPSHOT = { tag: 'target-snap' };

const docs: Record<string, unknown> = {};

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    getDoc: vi.fn(),
    hasDoc: vi.fn(),
    insertDoc: vi.fn(),
    replaceDoc: vi.fn(),
    removeDoc: vi.fn(),
    clearUndoHistory: vi.fn(),
    captureUndoHistory: vi.fn<() => UndoSnapshot>(() => ({ past: [], future: [], undoTree: null })),
    restoreUndoHistory: vi.fn(),
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
    // The rollback path writes with trySet: it runs after the documents have
    // been restored, where a throw would skip the projection that puts the
    // stores back in step with them. See #1557.
    storeTrySet: vi.fn(() => true),
    projectCrdtToStores: vi.fn(),
    compactProject: vi.fn(() => Promise.resolve()),
    loadCrdtProject: vi.fn(() => Promise.resolve(true)),
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
    clone: vi.fn((doc: unknown) => structuredClone(doc)),
}));

vi.mock('@automerge/automerge', () => ({ clone: mocks.clone }));
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
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mocks.projectCrdtToStores }));
vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('../../loadCrdtProject', () => ({ loadCrdtProject: mocks.loadCrdtProject }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: mocks.runCrdtPersistenceOperation,
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    clearUndoHistory: mocks.clearUndoHistory,
    captureUndoHistory: mocks.captureUndoHistory,
    restoreUndoHistory: mocks.restoreUndoHistory,
}));

describe('switchBranch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.flushAutomergeStorageWrites.mockImplementation(() => undefined);
        docs.root = ROOT_LIVE_DOC;
        docs.branch_feat = FEATURE_SNAPSHOT;
        docs.branch_other = TARGET_SNAPSHOT;
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
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.loadCrdtProject.mockResolvedValue(true);
        mocks.storeValue.activeBranchId = 'feat';
    });

    it('writes the outgoing branch live edits back to its snapshot before swapping', async () => {
        await switchBranch('other');

        // Regression: the outgoing branch (feat) is not main, so its live root
        // edits must be flushed into branch_feat — otherwise they are lost/aliased.
        const writeback = mocks.replaceDoc.mock.calls.find((c) => c[0] === 'branch_feat');
        expect(writeback).toBeDefined();

        // Then the target's snapshot is swapped into the root slot.
        const swap = mocks.replaceDoc.mock.calls.find((c) => c[0] === 'root');
        expect(swap).toBeDefined();
    });

    it('flushes deferred storage before reading the target and swapping the root slot', async () => {
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

        await switchBranch('other');

        expect(mocks.flushAutomergeStorageWrites).toHaveBeenCalledTimes(2);
        expect(order[0]).toBe('flush');
        expect(order.indexOf('flush', 1)).toBeLessThan(order.indexOf('replace:root'));
    });

    it('migrates an outgoing legacy main branch to an independent backing document', async () => {
        mocks.storeValue.activeBranchId = 'main';
        await switchBranch('other');

        expect(mocks.insertDoc).toHaveBeenCalledWith('branch_main', expect.anything());
        expect(mocks.replaceDoc).toHaveBeenCalledWith('root', expect.anything());
        const nextState = mocks.storeSet.mock.calls[0]?.[0];
        expect(nextState?.activeBranchId).toBe('other');
        expect(nextState?.branches).toContainEqual(
            expect.objectContaining({ branchId: 'main', rootDocId: 'branch_main' })
        );
    });

    it('persists after the swap', async () => {
        await switchBranch('other');
        expect(mocks.runCrdtPersistenceOperation).toHaveBeenCalledWith({
            type: 'root-lineage-transition',
            from: 'feat',
            to: 'other',
        });
        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ activeBranchId: 'other' }));
        expect(mocks.compactProject).toHaveBeenCalled();
    });

    it('rejects and restores the prior branch when persistence fails', async () => {
        const persistenceFailure = new Error('compaction failed');
        mocks.compactProject.mockRejectedValueOnce(persistenceFailure);

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        expect(mocks.loadCrdtProject).toHaveBeenCalledOnce();
        expect(mocks.storeTrySet).toHaveBeenLastCalledWith(expect.objectContaining({ activeBranchId: 'feat' }));
        expect(docs.root).toEqual(ROOT_LIVE_DOC);
        expect(docs.branch_feat).toEqual(FEATURE_SNAPSHOT);
    });

    it('restores the undo history captured before the swap when the transition rejects', async () => {
        const persistenceFailure = new Error('compaction failed');
        mocks.compactProject.mockRejectedValueOnce(persistenceFailure);
        const preSwitchEntry: UndoSnapshotEntry = {
            id: 'undo-1',
            kind: 'callback',
            label: 'Move clip',
            timestamp: 1,
            source: 'manual',
            undo: () => {},
            redo: () => undefined,
        };
        const preSwitchSnapshot: UndoSnapshot = { past: [preSwitchEntry], future: [], undoTree: null };
        mocks.captureUndoHistory.mockReturnValueOnce(preSwitchSnapshot);

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        // `apply()` clears undo history as a side effect of swapping the root
        // document; a rejected transition must restore the exact object capture
        // returned before the swap — not a structurally-equal stand-in, and not
        // a snapshot taken after clearUndoHistory() has already run.
        expect(mocks.captureUndoHistory).toHaveBeenCalledOnce();
        expect(mocks.restoreUndoHistory.mock.calls[0]?.[0]).toBe(preSwitchSnapshot);

        const captureOrder = mocks.captureUndoHistory.mock.invocationCallOrder[0];
        const clearOrder = mocks.clearUndoHistory.mock.invocationCallOrder[0];
        if (captureOrder === undefined || clearOrder === undefined) {
            throw new Error('Expected both captureUndoHistory and clearUndoHistory to have been invoked');
        }
        expect(captureOrder).toBeLessThan(clearOrder);
    });

    it('does not restore undo history when the switch succeeds', async () => {
        await switchBranch('other');
        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
    });

    it('clears undo history when the root document is swapped', async () => {
        await switchBranch('other');

        // The undo stack's inverse entries are recorded against the outgoing
        // branch's root document; once the root slot is swapped to another
        // branch's document, replaying them would apply an inverse recorded
        // against a document that is no longer active. Same reasoning as
        // switchArrangement clearing undo history on snapshot load.
        expect(mocks.clearUndoHistory).toHaveBeenCalledOnce();
    });

    it('is a no-op when switching to the already-active branch', async () => {
        await switchBranch('feat');
        expect(mocks.replaceDoc).not.toHaveBeenCalled();
        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.clearUndoHistory).not.toHaveBeenCalled();
    });

    it('rejects when the target branch does not exist', async () => {
        await expect(switchBranch('ghost')).rejects.toThrow(/Branch not found/);
    });
});

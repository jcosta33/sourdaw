import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type captureUndoHistory } from '#/modules/Command/useCases';

import { createCrdtPersistenceRootLineageConflictError } from '../../../errors/CrdtPersistenceRootLineageConflictError';
import { switchBranch } from '../switchBranch';

// Derived from the public callable's own return type rather than importing
// Command's private UndoEntry model across the module boundary.
type UndoSnapshot = ReturnType<typeof captureUndoHistory>;
type BranchStoreValue = {
    branches: Array<{ branchId: string; rootDocId: string }>;
    activeBranchId: string;
};

const ROOT_LIVE_DOC = { tag: 'root-live' };
const FEATURE_SNAPSHOT = { tag: 'feature-snap' };
const TARGET_SNAPSHOT = { tag: 'target-snap' };

const docs: Record<string, unknown> = {};

function createEmptyUndoSnapshot(): UndoSnapshot {
    return { past: [], future: [], undoTree: null };
}

function createUndoSnapshot(id: string): UndoSnapshot {
    const pastEntry: UndoSnapshot['past'][number] = {
        id,
        kind: 'callback',
        label: 'Move feature clip',
        timestamp: 1,
        source: 'manual',
        undo: () => {},
        redo: () => undefined,
    };
    const futureEntry: UndoSnapshot['future'][number] = {
        id: `${id}-redo`,
        kind: 'callback',
        label: 'Restore feature clip',
        timestamp: 2,
        source: 'manual',
        undo: () => {},
        redo: () => undefined,
    };
    return {
        past: [pastEntry],
        future: [futureEntry],
        undoTree: {
            enabled: true,
            tree: {
                nodes: {
                    [pastEntry.id]: {
                        id: pastEntry.id,
                        entry: pastEntry,
                        parentId: null,
                        children: [futureEntry.id],
                        activeBranch: 0,
                        createdAt: 1,
                        branchLabel: 'Captured feature edits',
                    },
                    [futureEntry.id]: {
                        id: futureEntry.id,
                        entry: futureEntry,
                        parentId: pastEntry.id,
                        children: [],
                        activeBranch: 0,
                        createdAt: 2,
                    },
                },
                currentNodeId: pastEntry.id,
                rootId: 'undo-root',
                nextId: 3,
            },
        },
    };
}

const mocks = vi.hoisted(() => ({
    flushAutomergeStorageWrites: vi.fn(),
    getDoc: vi.fn(),
    getDocIds: vi.fn(),
    getHeads: vi.fn(),
    hasDoc: vi.fn(),
    insertDoc: vi.fn(),
    replaceDoc: vi.fn(),
    removeDoc: vi.fn(),
    clearUndoHistory: vi.fn<() => void>(),
    captureUndoHistory: vi.fn<() => UndoSnapshot>(),
    restoreUndoHistory: vi.fn<(snapshot: UndoSnapshot) => void>(),
    undoHistory: createEmptyUndoSnapshot(),
    storeValue: {
        branches: [
            { branchId: 'main', rootDocId: 'root' },
            { branchId: 'feat', rootDocId: 'branch_feat' },
            { branchId: 'other', rootDocId: 'branch_other' },
        ],
        activeBranchId: 'feat',
    },
    storeSet: vi.fn<(state: BranchStoreValue) => void>(),
    // The rollback path writes with trySet: it runs after the documents have
    // been restored, where a throw would skip the projection that puts the
    // stores back in step with them. See #1557.
    storeTrySet: vi.fn<(state: BranchStoreValue) => boolean>(() => true),
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
        getDocIds: mocks.getDocIds,
        getHeads: mocks.getHeads,
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
        for (const id of Object.keys(docs)) {
            delete docs[id];
        }
        docs.root = ROOT_LIVE_DOC;
        docs.branch_feat = FEATURE_SNAPSHOT;
        docs.branch_other = TARGET_SNAPSHOT;
        mocks.getDoc.mockImplementation((id: string) => docs[id]);
        mocks.getDocIds.mockImplementation(() => Object.keys(docs));
        mocks.getHeads.mockImplementation((id: string) => {
            const doc = docs[id];
            if (!doc || typeof doc !== 'object') {
                return undefined;
            }
            const tag = Reflect.get(doc, 'tag');
            return typeof tag === 'string' ? [`head:${tag}`] : [];
        });
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
        mocks.runCrdtPersistenceOperation.mockResolvedValue(undefined);
        mocks.undoHistory = createEmptyUndoSnapshot();
        mocks.captureUndoHistory.mockImplementation(() => mocks.undoHistory);
        mocks.clearUndoHistory.mockImplementation(() => {
            mocks.undoHistory = createEmptyUndoSnapshot();
        });
        mocks.restoreUndoHistory.mockImplementation((snapshot) => {
            mocks.undoHistory = snapshot;
        });
        mocks.storeValue = {
            branches: [
                { branchId: 'main', rootDocId: 'root' },
                { branchId: 'feat', rootDocId: 'branch_feat' },
                { branchId: 'other', rootDocId: 'branch_other' },
            ],
            activeBranchId: 'feat',
        };
        mocks.storeSet.mockImplementation((state) => {
            mocks.storeValue = state;
        });
        mocks.storeTrySet.mockImplementation((state) => {
            mocks.storeValue = state;
            return true;
        });
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
        const preSwitchSnapshot = createUndoSnapshot('undo-1');
        mocks.undoHistory = preSwitchSnapshot;

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        // `apply()` clears undo history as a side effect of swapping the root
        // document; a rejected transition must restore the exact object capture
        // returned before the swap — not a structurally-equal stand-in, and not
        // a snapshot taken after clearUndoHistory() has already run.
        expect(mocks.captureUndoHistory).toHaveBeenCalledOnce();
        expect(mocks.restoreUndoHistory).toHaveBeenCalledOnce();
        expect(mocks.restoreUndoHistory.mock.calls[0]?.[0]).toBe(preSwitchSnapshot);
        expect(mocks.undoHistory).toBe(preSwitchSnapshot);
        expect(mocks.storeValue.activeBranchId).toBe('feat');
        expect(docs.root).toEqual(ROOT_LIVE_DOC);
        expect(docs.branch_feat).toEqual(FEATURE_SNAPSHOT);

        const captureOrder = mocks.captureUndoHistory.mock.invocationCallOrder[0];
        const clearOrder = mocks.clearUndoHistory.mock.invocationCallOrder[0];
        if (captureOrder === undefined || clearOrder === undefined) {
            throw new Error('Expected both captureUndoHistory and clearUndoHistory to have been invoked');
        }
        expect(captureOrder).toBeLessThan(clearOrder);
    });

    it('does not restore outgoing undo history when durable recovery selects another branch', async () => {
        const persistenceFailure = createCrdtPersistenceRootLineageConflictError({
            localRootLineage: 'feat',
            durableRootLineage: 'other',
        });
        const outgoingSnapshot = createUndoSnapshot('undo-outgoing-feat');
        const originalState = mocks.storeValue;
        mocks.undoHistory = outgoingSnapshot;
        mocks.runCrdtPersistenceOperation.mockRejectedValueOnce(persistenceFailure);
        mocks.loadCrdtProject.mockImplementationOnce(() => {
            docs.root = TARGET_SNAPSHOT;
            return Promise.resolve(true);
        });

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        expect(mocks.loadCrdtProject).toHaveBeenCalledOnce();
        expect(originalState.activeBranchId).toBe('feat');
        expect(mocks.storeValue.activeBranchId).toBe('other');
        expect(docs.root).toEqual(TARGET_SNAPSHOT);
        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('does not restore outgoing undo when durable recovery changes only branch ownership', async () => {
        const persistenceFailure = createCrdtPersistenceRootLineageConflictError({
            localRootLineage: 'feat',
            durableRootLineage: 'other',
        });
        const outgoingSnapshot = createUndoSnapshot('undo-outgoing-same-content');
        const capturedDocumentHeads = Object.fromEntries(Object.keys(docs).map((id) => [id, mocks.getHeads(id)]));
        mocks.undoHistory = outgoingSnapshot;
        mocks.runCrdtPersistenceOperation.mockRejectedValueOnce(persistenceFailure);

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        expect(mocks.loadCrdtProject).toHaveBeenCalledOnce();
        expect(mocks.storeValue.activeBranchId).toBe('other');
        expect(Object.keys(docs)).toEqual(Object.keys(capturedDocumentHeads));
        expect(Object.fromEntries(Object.keys(docs).map((id) => [id, mocks.getHeads(id)]))).toEqual(
            capturedDocumentHeads
        );
        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('does not restore outgoing undo history when recovered root heads changed on the same branch', async () => {
        const persistenceFailure = new Error('compaction failed');
        mocks.compactProject.mockRejectedValueOnce(persistenceFailure);
        mocks.undoHistory = createUndoSnapshot('undo-before-root-change');
        mocks.loadCrdtProject.mockImplementationOnce(() => {
            docs.root = { tag: 'root-recovered-change' };
            return Promise.resolve(true);
        });

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        expect(mocks.storeValue.activeBranchId).toBe('feat');
        expect(docs.root).toEqual({ tag: 'root-recovered-change' });
        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('does not restore outgoing undo history when recovered child heads changed on the same branch', async () => {
        const persistenceFailure = new Error('compaction failed');
        docs.child = { tag: 'child-before' };
        mocks.compactProject.mockRejectedValueOnce(persistenceFailure);
        mocks.undoHistory = createUndoSnapshot('undo-before-child-change');
        mocks.loadCrdtProject.mockImplementationOnce(() => {
            docs.child = { tag: 'child-after' };
            return Promise.resolve(true);
        });

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        expect(mocks.storeValue.activeBranchId).toBe('feat');
        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('does not restore outgoing undo history when recovered document membership changed on the same branch', async () => {
        const persistenceFailure = new Error('compaction failed');
        mocks.compactProject.mockRejectedValueOnce(persistenceFailure);
        mocks.undoHistory = createUndoSnapshot('undo-before-membership-change');
        mocks.loadCrdtProject.mockImplementationOnce(() => {
            docs.child = { tag: 'recovered-child' };
            return Promise.resolve(true);
        });

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        expect(mocks.storeValue.activeBranchId).toBe('feat');
        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('does not restore outgoing undo history when the recovered branch reference is unavailable', async () => {
        const persistenceFailure = new Error('compaction failed');
        mocks.compactProject.mockRejectedValueOnce(persistenceFailure);
        mocks.undoHistory = createUndoSnapshot('undo-before-missing-reference');
        mocks.loadCrdtProject.mockImplementationOnce(() => {
            delete docs.root;
            return Promise.resolve(true);
        });

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        expect(mocks.storeValue.activeBranchId).toBe('feat');
        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('preserves the transition failure and clears undo when the recovered reference cannot be inspected', async () => {
        const persistenceFailure = new Error('compaction failed');
        mocks.compactProject.mockRejectedValueOnce(persistenceFailure);
        mocks.undoHistory = createUndoSnapshot('undo-before-inspection-failure');
        mocks.getDocIds
            .mockImplementationOnce(() => Object.keys(docs))
            .mockImplementationOnce(() => {
                throw new Error('recovered reference unavailable');
            });

        await expect(switchBranch('other')).rejects.toBe(persistenceFailure);

        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
        expect(mocks.clearUndoHistory).toHaveBeenCalledTimes(2);
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('does not restore undo history when the switch succeeds', async () => {
        mocks.undoHistory = createUndoSnapshot('undo-before-success');

        await switchBranch('other');

        expect(mocks.restoreUndoHistory).not.toHaveBeenCalled();
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('clears undo history when the root document is swapped', async () => {
        mocks.undoHistory = createUndoSnapshot('undo-before-swap');

        await switchBranch('other');

        // The undo stack's inverse entries are recorded against the outgoing
        // branch's root document; once the root slot is swapped to another
        // branch's document, replaying them would apply an inverse recorded
        // against a document that is no longer active. Same reasoning as
        // switchArrangement clearing undo history on snapshot load.
        expect(mocks.clearUndoHistory).toHaveBeenCalledOnce();
        expect(mocks.undoHistory).toEqual(createEmptyUndoSnapshot());
    });

    it('is a no-op when switching to the already-active branch', async () => {
        const unchangedSnapshot = createUndoSnapshot('undo-before-no-op');
        mocks.undoHistory = unchangedSnapshot;

        await switchBranch('feat');

        expect(mocks.replaceDoc).not.toHaveBeenCalled();
        expect(mocks.storeSet).not.toHaveBeenCalled();
        expect(mocks.clearUndoHistory).not.toHaveBeenCalled();
        expect(mocks.undoHistory).toBe(unchangedSnapshot);
    });

    it('rejects when the target branch does not exist', async () => {
        await expect(switchBranch('ghost')).rejects.toThrow(/Branch not found/);
    });
});

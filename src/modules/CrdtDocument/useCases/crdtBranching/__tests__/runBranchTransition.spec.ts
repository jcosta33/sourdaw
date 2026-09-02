import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockCloneDoc,
    mockIsAppError,
    mockLogger,
    mockFlushStorage,
    mockAutomergeRepo,
    mockBranchStore,
    mockCompactProject,
    mockLoadCrdtProject,
    mockProjectCrdtToStores,
    undoHistory,
    mockCaptureUndoHistory,
    mockRestoreUndoHistory,
} = vi.hoisted(() => {
    const undoHistory = { current: { past: ['original-entry'], future: [] } as { past: unknown[]; future: unknown[] } };
    return {
        mockCloneDoc: vi.fn((doc: unknown) => doc),
        mockIsAppError: vi.fn(() => false),
        mockLogger: { warn: vi.fn() },
        mockFlushStorage: vi.fn(),
        mockAutomergeRepo: {
            getDoc: vi.fn(() => null),
            hasDoc: vi.fn(() => false),
            removeDoc: vi.fn(),
            replaceDoc: vi.fn(),
            insertDoc: vi.fn(),
        },
        mockBranchStore: {
            set: vi.fn(),
            trySet: vi.fn(() => true),
        },
        mockCompactProject: vi.fn(() => Promise.resolve()),
        mockLoadCrdtProject: vi.fn(() => Promise.resolve(true)),
        mockProjectCrdtToStores: vi.fn(),
        undoHistory,
        // Mirrors the real captureUndoHistory/restoreUndoHistory pair (Command
        // module) against a shared mutable double, so a test can assert the
        // undo state observable after a rollback, not just that some function
        // was called.
        mockCaptureUndoHistory: vi.fn(() => structuredClone(undoHistory.current)),
        mockRestoreUndoHistory: vi.fn((state: { past: unknown[]; future: unknown[] }) => {
            undoHistory.current = state;
        }),
    };
});

vi.mock('@automerge/automerge', () => ({ clone: mockCloneDoc }));
vi.mock('#/infra/errors/isAppError', () => ({ isAppError: mockIsAppError }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: mockFlushStorage,
}));
vi.mock('#/modules/Command/useCases', () => ({
    captureUndoHistory: mockCaptureUndoHistory,
    restoreUndoHistory: mockRestoreUndoHistory,
}));
vi.mock('../../../repositories/automergeRepository', () => ({ automergeRepository: mockAutomergeRepo }));
vi.mock('../../../stores/branchStore', () => ({ branchStore: mockBranchStore }));
vi.mock('../../compactProject', () => ({ compactProject: mockCompactProject }));
vi.mock('../../loadCrdtProject', () => ({ loadCrdtProject: mockLoadCrdtProject }));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mockProjectCrdtToStores }));

import { runBranchTransition } from '../runBranchTransition';

const previousState = {
    activeBranchId: 'branch-a',
    branches: [
        {
            branchId: 'branch-a',
            name: 'A',
            rootDocId: 'doc-a',
            sourceBranchId: null,
            createdAt: 0,
            createdFromHeads: [],
            note: '',
        },
    ],
};

describe('runBranchTransition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLoadCrdtProject.mockResolvedValue(true);
        mockCompactProject.mockResolvedValue(undefined);
        undoHistory.current = { past: ['original-entry'], future: [] };
    });

    // Regression: switchBranch's `apply()` clears undo history as part of
    // swapping the root document (Ctrl+Z must not replay an inverse recorded
    // against a document that is no longer active). If the transition then
    // fails during persistence, the document swap is rolled back but nothing
    // previously restored the undo history apply() had already cleared — a
    // user who hit a transient persistence failure lost their undo stack for
    // a branch switch that never actually happened. See #3320 review finding.
    it('restores the undo history apply() cleared when persistence rejects', async () => {
        const persistenceError = new Error('persistence failed');

        await expect(
            runBranchTransition({
                affectedDocIds: [],
                apply: () => {
                    // Simulates switchBranch calling clearUndoHistory() inside apply().
                    undoHistory.current = { past: [], future: [] };
                    return { result: 'ok' };
                },
                persistenceOperation: () => Promise.reject(persistenceError),
                previousState,
            })
        ).rejects.toBe(persistenceError);

        expect(undoHistory.current).toEqual({ past: ['original-entry'], future: [] });
        expect(mockRestoreUndoHistory).toHaveBeenCalledWith({ past: ['original-entry'], future: [] });
    });

    it('does not restore undo history when the transition succeeds', async () => {
        const result = await runBranchTransition({
            affectedDocIds: [],
            apply: () => {
                undoHistory.current = { past: [], future: [] };
                return { result: 'ok' };
            },
            persistenceOperation: () => Promise.resolve(),
            previousState,
        });

        expect(result).toBe('ok');
        expect(mockRestoreUndoHistory).not.toHaveBeenCalled();
        // The clear from apply() stands: nothing rolled back a transition that committed.
        expect(undoHistory.current).toEqual({ past: [], future: [] });
    });
});

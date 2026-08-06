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
    mockRunPersistenceOp,
} = vi.hoisted(() => ({
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
    },
    mockCompactProject: vi.fn(() => Promise.resolve()),
    mockLoadCrdtProject: vi.fn(() => Promise.resolve(true)),
    mockProjectCrdtToStores: vi.fn(),
    mockRunPersistenceOp: vi.fn(() => Promise.resolve()),
}));

vi.mock('@automerge/automerge', () => ({ clone: mockCloneDoc }));
vi.mock('#/infra/errors/isAppError', () => ({ isAppError: mockIsAppError }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: mockFlushStorage,
}));
vi.mock('../../../repositories/automergeRepository', () => ({ automergeRepository: mockAutomergeRepo }));
vi.mock('../../../stores/branchStore', () => ({ branchStore: mockBranchStore }));
vi.mock('../../compactProject', () => ({ compactProject: mockCompactProject }));
vi.mock('../../loadCrdtProject', () => ({ loadCrdtProject: mockLoadCrdtProject }));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mockProjectCrdtToStores }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: mockRunPersistenceOp,
}));

import { runBranchLineageTransition } from '../runBranchLineageTransition';

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

describe('runBranchLineageTransition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLoadCrdtProject.mockResolvedValue(true);
        mockCompactProject.mockResolvedValue(undefined);
        mockRunPersistenceOp.mockResolvedValue(undefined);
    });

    it('applies the transition, sets next state, and returns the result', async () => {
        const nextState = { ...previousState, activeBranchId: 'branch-b' };
        const result = await runBranchLineageTransition({
            affectedDocIds: ['doc-1'],
            apply: () => ({ nextState, result: 'success' }),
            from: 'branch-a',
            previousState,
            to: 'branch-b',
        });
        expect(result).toBe('success');
        expect(mockBranchStore.set).toHaveBeenCalledWith(nextState);
        expect(mockProjectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(mockRunPersistenceOp).toHaveBeenCalledWith({
            type: 'root-lineage-transition',
            from: 'branch-a',
            to: 'branch-b',
        });
    });

    it('flushes storage before snapshotting and sets transition guard', async () => {
        await runBranchLineageTransition({
            affectedDocIds: [],
            apply: () => ({ result: 'ok' }),
            from: 'a',
            previousState,
            to: 'b',
        });
        expect(mockFlushStorage).toHaveBeenCalledTimes(1);
    });

    it('throws when a transition is already in progress (re-entrancy guard)', async () => {
        // Block the persistence operation so the first transition stays in-flight
        let resolvePersistence: (() => void) | undefined;
        mockRunPersistenceOp.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolvePersistence = resolve;
            })
        );

        const firstTransition = runBranchLineageTransition({
            affectedDocIds: [],
            apply: () => ({ result: 'first' }),
            from: 'a',
            previousState,
            to: 'b',
        });

        // Wait for the first transition to reach the await point (guard is set)
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Second call should throw re-entrancy error
        await expect(
            runBranchLineageTransition({
                affectedDocIds: [],
                apply: () => ({ result: 'second' }),
                from: 'a',
                previousState,
                to: 'c',
            })
        ).rejects.toThrow('already in progress');

        // Release the first transition
        resolvePersistence?.();
        await firstTransition;
    });

    it('rolls back snapshots and restores previous state when apply throws', async () => {
        (mockAutomergeRepo.getDoc as ReturnType<typeof vi.fn>).mockReturnValue({ data: 'doc-1-content' });
        const error = new Error('apply failed');
        await expect(
            runBranchLineageTransition({
                affectedDocIds: ['doc-1'],
                apply: () => {
                    throw error;
                },
                from: 'a',
                previousState,
                to: 'b',
            })
        ).rejects.toThrow('apply failed');

        // Recovery: snapshots restored, branch store reset to previous, stores re-projected
        expect(mockBranchStore.set).toHaveBeenCalledWith(previousState);
        expect(mockProjectCrdtToStores).toHaveBeenCalled();
        expect(mockLoadCrdtProject).toHaveBeenCalled();
    });

    it('deduplicates affectedDocIds when creating snapshots', async () => {
        mockAutomergeRepo.getDoc.mockReturnValue(null);
        await runBranchLineageTransition({
            affectedDocIds: ['doc-1', 'doc-1', 'doc-2'],
            apply: () => ({ result: 'ok' }),
            from: 'a',
            previousState,
            to: 'b',
        });
        // 2 unique doc IDs → 2 snapshot calls
        expect(mockAutomergeRepo.getDoc).toHaveBeenCalledTimes(2);
    });
});

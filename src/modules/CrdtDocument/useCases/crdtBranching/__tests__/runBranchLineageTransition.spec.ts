import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockCloneDoc,
    mockIsAppError,
    mockLogger,
    mockFlushStorage,
    mockCaptureTransactionScope,
    mockAutomergeRepo,
    mockBranchStore,
    mockBranchStateAuthority,
    mockCompactProject,
    mockLoadCrdtProject,
    mockProjectCrdtToStores,
    mockRunPersistenceOp,
    persistenceQueue,
} = vi.hoisted(() => ({
    mockCloneDoc: vi.fn((doc: unknown) => doc),
    mockIsAppError: vi.fn(() => false),
    mockLogger: { warn: vi.fn() },
    mockFlushStorage: vi.fn(),
    // No ambient action transaction in this unit, so the captured scope runs
    // its callback where it stands — what the real capture returns outside one.
    mockCaptureTransactionScope: vi.fn(
        () =>
            <Result>(run: () => Result) =>
                run()
    ),
    mockAutomergeRepo: {
        getDoc: vi.fn(() => null),
        getRootId: vi.fn(() => 'root'),
        getRootIdentityEpoch: vi.fn(() => 1),
        hasDoc: vi.fn(() => false),
        removeDoc: vi.fn(),
        replaceDoc: vi.fn(),
        replaceRootContentPreservingIdentity: vi.fn(),
        insertDoc: vi.fn(),
    },
    mockBranchStore: { set: vi.fn() },
    mockBranchStateAuthority: {
        captureRevision: vi.fn(() => 4),
        commit: vi.fn((): Promise<{ status: string; revision?: number; reason?: string }> =>
            Promise.resolve({ status: 'committed', revision: 5 })
        ),
    },
    mockCompactProject: vi.fn(() => Promise.resolve()),
    mockLoadCrdtProject: vi.fn(() => Promise.resolve(true)),
    mockProjectCrdtToStores: vi.fn(),
    mockRunPersistenceOp: vi.fn(() => Promise.resolve()),
    /**
     * The two figures the persistence queue keeps about itself.
     *
     * `generation` moves whenever the queue moves on — a load, an HMR
     * migration, or this transition's own lineage operation. `replacement`
     * moves only when another project takes the live one's place. Both are
     * published here so a case can move one without the other, and which one
     * the transition's rollback guard reads is what decides the outcome.
     */
    persistenceQueue: { generation: 7, replacement: 3 },
}));

vi.mock('@automerge/automerge', () => ({ clone: mockCloneDoc }));
vi.mock('#/infra/errors/isAppError', () => ({ isAppError: mockIsAppError }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    captureAutomergeStorageTransactionScope: mockCaptureTransactionScope,
    flushAutomergeStorageWrites: mockFlushStorage,
}));
vi.mock('../../../repositories/automergeRepository', () => ({ automergeRepository: mockAutomergeRepo }));
vi.mock('../../../stores/branchStore', () => ({ branchStore: mockBranchStore }));
vi.mock('../../../repositories/branchStateAuthority', () => ({
    branchStateAuthority: mockBranchStateAuthority,
}));
vi.mock('../../compactProject', () => ({ compactProject: mockCompactProject }));
vi.mock('../../loadCrdtProject', () => ({ loadCrdtProject: mockLoadCrdtProject }));
vi.mock('../../projection/projectProjection', () => ({ projectCrdtToStores: mockProjectCrdtToStores }));
vi.mock('../../runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: mockRunPersistenceOp,
}));
// Mocked at the queue rather than at the accessor in front of it, so the real
// accessor the transition imports is the one under test: a guard reading the
// wrong figure reads it through this same double.
vi.mock('../../crdtPersistenceQueueCoordinator', () => ({
    crdtPersistenceQueueCoordinator: {
        currentGeneration: () => persistenceQueue.generation,
        currentReplacement: () => persistenceQueue.replacement,
    },
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
        mockBranchStateAuthority.captureRevision.mockReturnValue(4);
        mockBranchStateAuthority.commit.mockResolvedValue({ status: 'committed', revision: 5 });
        persistenceQueue.generation = 7;
        persistenceQueue.replacement = 3;
    });

    it('applies the transition, commits next state, and returns the result', async () => {
        const nextState = { ...previousState, activeBranchId: 'branch-b' };
        const capturedScope = <Result>(run: () => Result): Result => run();
        mockCaptureTransactionScope.mockReturnValueOnce(capturedScope);
        const result = await runBranchLineageTransition({
            affectedDocIds: ['doc-1'],
            apply: () => ({ nextState, result: 'success' }),
            from: 'branch-a',
            previousState,
            to: 'branch-b',
        });
        expect(result).toBe('success');
        // The durable commit is the write: it carries the revision the
        // transition observed and the storage transaction the caller was still
        // inside, and the authority is what projects it to memory.
        expect(mockBranchStateAuthority.commit).toHaveBeenCalledWith({
            expectedRevision: 4,
            next: nextState,
            projectionScope: capturedScope,
        });
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

        // Recovery: snapshots restored and stores re-projected. The throw came
        // before the commit, so the branch list was never touched — and a
        // memory write here would put a captured list back over one this
        // transition never replaced.
        expect(mockProjectCrdtToStores).toHaveBeenCalled();
        expect(mockLoadCrdtProject).toHaveBeenCalled();
        expect(mockBranchStateAuthority.commit).not.toHaveBeenCalled();
        expect(mockBranchStore.set).not.toHaveBeenCalled();
    });

    it('rolls back and throws when the durable commit is refused', async () => {
        (mockAutomergeRepo.getDoc as ReturnType<typeof vi.fn>).mockReturnValue({ data: 'doc-1-content' });
        mockBranchStateAuthority.commit.mockResolvedValueOnce({ status: 'refused', reason: 'conflict' });
        const nextState = { ...previousState, activeBranchId: 'branch-b' };

        await expect(
            runBranchLineageTransition({
                affectedDocIds: ['doc-1'],
                apply: () => ({ nextState, result: 'success' }),
                from: 'branch-a',
                previousState,
                to: 'branch-b',
            })
        ).rejects.toThrow(/Branch state could not be persisted \(conflict\)/);

        expect(mockAutomergeRepo.replaceDoc).not.toHaveBeenCalledWith('doc-1', nextState);
        // A refused commit wrote nothing, so there is no revision to swap back
        // — and memory is left where the refused transaction put it, which is
        // the list whose revision the refusal was measured against.
        expect(mockBranchStateAuthority.commit).toHaveBeenCalledTimes(1);
        expect(mockBranchStore.set).not.toHaveBeenCalled();
        expect(mockProjectCrdtToStores).toHaveBeenCalled();
    });

    /**
     * T1 — a project reset replaced the repository under this transition. The
     * documents these snapshots describe belong to a repository that no longer
     * exists, and the branch list the rollback would restore describes that
     * repository too, so writing either back would put the replaced project's
     * branches and documents over the replacement's.
     */
    it('skips the rollback when the project was replaced mid-transition', async () => {
        (mockAutomergeRepo.getDoc as ReturnType<typeof vi.fn>).mockReturnValue({ data: 'doc-1-content' });

        await expect(
            runBranchLineageTransition({
                affectedDocIds: ['doc-1'],
                apply: () => {
                    // Faithful to `beginPersistenceReplacement`: a reset
                    // revokes the generation and then counts the replacement.
                    persistenceQueue.generation += 1;
                    persistenceQueue.replacement += 1;
                    throw new Error('apply failed');
                },
                from: 'a',
                previousState,
                to: 'b',
            })
        ).rejects.toThrow('apply failed');

        expect(mockAutomergeRepo.replaceDoc).not.toHaveBeenCalled();
        expect(mockAutomergeRepo.replaceRootContentPreservingIdentity).not.toHaveBeenCalled();
        expect(mockAutomergeRepo.removeDoc).not.toHaveBeenCalled();
        expect(mockLoadCrdtProject).not.toHaveBeenCalled();
        expect(mockProjectCrdtToStores).not.toHaveBeenCalled();
        expect(mockBranchStateAuthority.commit).not.toHaveBeenCalled();
        expect(mockBranchStore.set).not.toHaveBeenCalled();
    });

    /**
     * T1b — the lineage operation this transition starts begins a new
     * persistence generation before the commit is decided, and replaces no
     * project. A refused commit therefore still has to unwind: the documents
     * these snapshots describe are the live ones, and the branch list the
     * rollback restores is the list this project still has.
     */
    it('rolls back a refused commit whose lineage operation began a new persistence generation', async () => {
        (mockAutomergeRepo.getDoc as ReturnType<typeof vi.fn>).mockReturnValue({ data: 'doc-1-content' });
        mockRunPersistenceOp.mockImplementation(() => {
            // Faithful to the coordinator: `root-lineage-transition` runs
            // `beginRootLineageTransition` synchronously, so the generation it
            // revokes has already moved by the time the commit is refused. The
            // replacement count stays put — no project was replaced.
            persistenceQueue.generation += 1;
            return Promise.resolve();
        });
        mockBranchStateAuthority.commit.mockResolvedValueOnce({ status: 'refused', reason: 'conflict' });
        const nextState = { ...previousState, activeBranchId: 'branch-b' };

        await expect(
            runBranchLineageTransition({
                affectedDocIds: ['doc-1'],
                apply: () => ({ nextState, result: 'success' }),
                from: 'branch-a',
                previousState,
                to: 'branch-b',
            })
        ).rejects.toThrow(/Branch state could not be persisted \(conflict\)/);

        expect(persistenceQueue.generation).toBe(8);
        expect(persistenceQueue.replacement).toBe(3);
        // The rollback ran whole: the snapshots went back, persistence was
        // reloaded, and the stores were re-projected off the restored documents.
        expect(mockAutomergeRepo.insertDoc).toHaveBeenCalledWith('doc-1', { data: 'doc-1-content' });
        expect(mockLoadCrdtProject).toHaveBeenCalled();
        expect(mockProjectCrdtToStores).toHaveBeenCalled();
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

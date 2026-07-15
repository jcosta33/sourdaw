import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionalPersistence } from './helpers/transactionalPersistence';

const mocks = vi.hoisted(() => ({
    openDatabase: vi.fn(),
}));

vi.mock('../../repositories/crdtPersistence/helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: mocks.openDatabase,
}));
vi.mock('#/infra/store/storage/createAutomergeStorage', () => ({
    flushAutomergeStorageWrites: vi.fn(),
}));
vi.mock('#/utils/HMR/createHmrPersistentState', () => ({
    createHmrPersistentState: <State>(_key: string, factory: () => State): State => factory(),
}));

type PersistenceContext = {
    queue: typeof import('../crdtPersistenceQueue');
    repository: typeof import('../../repositories/automergeRepository');
    snapshot: typeof import('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb');
};

type OperationOutcome = { kind: 'resolved' } | { kind: 'rejected'; error: unknown };

type ConflictAttempt = {
    error: unknown;
    unexpectedWrites: readonly import('./helpers/transactionalPersistence').TransactionWrite[];
};

type LoadedPersistenceSnapshot = {
    authority: { epoch: string; revision: number };
    bundle: Map<string, Uint8Array>;
};

async function importContext(): Promise<PersistenceContext> {
    vi.resetModules();
    const [queue, repository, snapshot] = await Promise.all([
        import('../crdtPersistenceQueue'),
        import('../../repositories/automergeRepository'),
        import('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb'),
    ]);
    return { queue, repository, snapshot };
}

async function loadContextSnapshot({
    context,
    snapshot,
}: {
    context: PersistenceContext;
    snapshot: LoadedPersistenceSnapshot;
}): Promise<void> {
    const loaded = await context.queue.runCrdtPersistenceLoad(async ({ shouldCommit }) => {
        const committed = await context.repository.automergeRepository.loadAll({
            bundle: snapshot.bundle,
            shouldCommit,
        });
        return { loaded: committed, snapshot };
    });
    expect(loaded).toBe(true);
}

async function createSharedContexts({
    persistence,
    documentIds = [],
}: {
    persistence: TransactionalPersistence;
    documentIds?: readonly string[];
}): Promise<{ first: PersistenceContext; second: PersistenceContext }> {
    const first = await importContext();
    const second = await importContext();

    first.repository.automergeRepository.createProject('project');
    for (const documentId of documentIds) {
        first.repository.automergeRepository.createChildDoc(documentId);
    }
    const basePersist = first.queue.runCrdtPersistenceOperation('compact');
    const baseTransaction = await persistence.waitForTransaction('readwrite', 1);
    baseTransaction.complete();
    await basePersist;

    const baseSnapshot = await first.snapshot.loadPersistenceSnapshotFromIdb();
    if (!baseSnapshot?.bundle) {
        throw new Error('Expected the shared base snapshot');
    }
    await loadContextSnapshot({ context: second, snapshot: baseSnapshot });

    return { first, second };
}

async function finishConflictAttempt({
    persistence,
    operation,
    conflictOccurrence,
}: {
    persistence: TransactionalPersistence;
    operation: Promise<void>;
    conflictOccurrence: number;
}): Promise<ConflictAttempt> {
    const conflictTransaction = await persistence.waitForTransaction('readwrite', conflictOccurrence);
    expect(conflictTransaction.writes).toEqual([]);

    const outcomePromise: Promise<OperationOutcome> = operation.then(
        () => ({ kind: 'resolved' }),
        (error: unknown) => ({ kind: 'rejected', error })
    );
    const followUpPromise = persistence
        .waitForTransaction('readwrite', conflictOccurrence + 1)
        .then((transaction) => ({ kind: 'follow-up' as const, transaction }));

    conflictTransaction.complete();
    const result = await Promise.race([outcomePromise, followUpPromise]);
    if (result.kind === 'follow-up') {
        const unexpectedWrites = [...result.transaction.writes];
        result.transaction.abort();
        const finalOutcome = await outcomePromise;
        return {
            error: finalOutcome.kind === 'rejected' ? finalOutcome.error : null,
            unexpectedWrites,
        };
    }

    return {
        error: result.kind === 'rejected' ? result.error : null,
        unexpectedWrites: [],
    };
}

async function runRetryAttempt({
    persistence,
    operation,
}: {
    persistence: TransactionalPersistence;
    operation: Promise<void>;
}): Promise<{ error: unknown; writes: readonly import('./helpers/transactionalPersistence').TransactionWrite[] }> {
    const occurrence = persistence.getTransactions('readwrite').length + 1;
    const transaction = await persistence.waitForTransaction('readwrite', occurrence);
    const writes = [...transaction.writes];
    if (writes.length === 0) {
        transaction.complete();
    } else {
        transaction.abort();
    }

    const outcome: OperationOutcome = await operation.then(
        () => ({ kind: 'resolved' }),
        (error: unknown) => ({ kind: 'rejected', error })
    );
    return {
        error: outcome.kind === 'rejected' ? outcome.error : null,
        writes,
    };
}

async function expectDurableDocumentPresence({
    context,
    documentId,
    present,
    expectedRoot,
}: {
    context: PersistenceContext;
    documentId: string;
    present: boolean;
    expectedRoot?: Record<string, unknown>;
}): Promise<void> {
    const snapshot = await context.snapshot.loadPersistenceSnapshotFromIdb();
    if (!snapshot?.bundle) {
        throw new Error('Expected a durable snapshot');
    }

    const reload = await importContext();
    await reload.repository.automergeRepository.loadAll({
        bundle: snapshot.bundle,
        shouldCommit: () => true,
    });
    expect(reload.repository.automergeRepository.hasDoc(documentId)).toBe(present);
    if (expectedRoot) {
        expect(reload.repository.automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject(
            expectedRoot
        );
    }
}

describe('CRDT persistence across independent queue contexts', () => {
    let persistence: TransactionalPersistence;

    beforeEach(() => {
        persistence = new TransactionalPersistence();
        mocks.openDatabase.mockResolvedValue(persistence.database);
        vi.stubGlobal(
            'Worker',
            class UnavailableWorker {
                constructor() {
                    throw new Error('worker unavailable in persistence concurrency test');
                }
            }
        );
    });

    it('merges a fresh tab incremental before a stale tab full replacement and reloads both edits', async () => {
        const firstContext = await importContext();
        const secondContext = await importContext();
        firstContext.repository.automergeRepository.createProject('project');

        const basePersist = firstContext.queue.runCrdtPersistenceOperation('compact');
        const baseTransaction = await persistence.waitForTransaction('readwrite', 1);
        baseTransaction.complete();
        await basePersist;

        const baseSnapshot = await firstContext.snapshot.loadPersistenceSnapshotFromIdb();
        if (!baseSnapshot?.bundle) {
            throw new Error('Expected the shared base snapshot');
        }
        await loadContextSnapshot({ context: secondContext, snapshot: baseSnapshot });

        firstContext.repository.automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.fromIncrementalTab = true;
        });
        const incrementalPersist = firstContext.queue.runCrdtPersistenceOperation('incremental');
        const incrementalTransaction = await persistence.waitForTransaction('readwrite', 2);
        expect(incrementalTransaction.writes.some((write) => write.kind === 'add')).toBe(true);
        incrementalTransaction.complete();
        await incrementalPersist;

        secondContext.repository.automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.fromStaleFullTab = true;
        });
        const staleFullPersist = secondContext.queue.runCrdtPersistenceOperation('compact');
        const conflictTransaction = await persistence.waitForTransaction('readwrite', 3);
        expect(conflictTransaction.writes).toEqual([]);
        conflictTransaction.complete();

        const mergedFullTransaction = await persistence.waitForTransaction('readwrite', 4);
        expect(mergedFullTransaction.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
        expect(mergedFullTransaction.writes.some((write) => write.kind === 'add')).toBe(false);
        mergedFullTransaction.complete();
        await staleFullPersist;

        const finalSnapshot = await secondContext.snapshot.loadPersistenceSnapshotFromIdb();
        if (!finalSnapshot?.bundle) {
            throw new Error('Expected the merged full snapshot');
        }
        expect(finalSnapshot.authority).toEqual({ epoch: '', revision: 3 });
        expect([...finalSnapshot.bundle.keys()]).toEqual(['root']);

        firstContext.repository.automergeRepository.reset();
        await firstContext.repository.automergeRepository.loadAll({
            bundle: finalSnapshot.bundle,
            shouldCommit: () => true,
        });
        expect(firstContext.repository.automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            fromIncrementalTab: true,
            fromStaleFullTab: true,
        });
    });

    it('keeps equal-membership incremental conflicts reconciled through a later compaction', async () => {
        const { first, second } = await createSharedContexts({ persistence });

        first.repository.automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.fromFirstIncremental = true;
        });
        const firstPersist = first.queue.runCrdtPersistenceOperation('incremental');
        const firstTransaction = await persistence.waitForTransaction('readwrite', 2);
        firstTransaction.complete();
        await firstPersist;

        second.repository.automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.fromSecondIncremental = true;
        });
        const secondPersist = second.queue.runCrdtPersistenceOperation('incremental');
        const conflictTransaction = await persistence.waitForTransaction('readwrite', 3);
        expect(conflictTransaction.writes).toEqual([]);
        conflictTransaction.complete();

        const retryTransaction = await persistence.waitForTransaction('readwrite', 4);
        expect(retryTransaction.writes.some((write) => write.kind === 'add')).toBe(true);
        retryTransaction.complete();
        await secondPersist;

        const compaction = second.queue.runCrdtPersistenceOperation('compact');
        const compactionTransaction = await persistence.waitForTransaction('readwrite', 5);
        compactionTransaction.complete();
        await compaction;

        const snapshot = await first.snapshot.loadPersistenceSnapshotFromIdb();
        if (!snapshot?.bundle) {
            throw new Error('Expected compacted content from both realms');
        }
        const reload = await importContext();
        await reload.repository.automergeRepository.loadAll({
            bundle: snapshot.bundle,
            shouldCommit: () => true,
        });
        expect(reload.repository.automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            fromFirstIncremental: true,
            fromSecondIncremental: true,
        });
    });

    it('rejects stale full compaction after a remote deletion and poisons its retry', async () => {
        const { first, second } = await createSharedContexts({
            persistence,
            documentIds: ['branch_stale'],
        });

        first.repository.automergeRepository.removeDoc('branch_stale');
        const deletionPersist = first.queue.runCrdtPersistenceOperation('compact');
        const deletionTransaction = await persistence.waitForTransaction('readwrite', 2);
        deletionTransaction.complete();
        await deletionPersist;

        second.repository.automergeRepository.changeDoc('branch_stale', (doc: Record<string, unknown>) => {
            doc.staleEdit = true;
        });
        const stalePersist = second.queue.runCrdtPersistenceOperation('compact');
        const firstAttempt = await finishConflictAttempt({
            persistence,
            operation: stalePersist,
            conflictOccurrence: 3,
        });

        const retry = await runRetryAttempt({
            persistence,
            operation: second.queue.runCrdtPersistenceOperation('compact'),
        });

        expect(firstAttempt.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
        expect(firstAttempt.unexpectedWrites).toEqual([]);
        expect(retry.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
        expect(retry.writes).toEqual([]);
        await expectDurableDocumentPresence({ context: first, documentId: 'branch_stale', present: false });
    });

    it('rejects stale incremental persistence after a remote deletion and poisons its retry', async () => {
        const { first, second } = await createSharedContexts({
            persistence,
            documentIds: ['branch_stale'],
        });

        const establishSecondContextShape = second.queue.runCrdtPersistenceOperation('compact');
        const secondContextCompaction = await persistence.waitForTransaction('readwrite', 2);
        secondContextCompaction.complete();
        await establishSecondContextShape;

        const currentSnapshot = await first.snapshot.loadPersistenceSnapshotFromIdb();
        if (!currentSnapshot) {
            throw new Error('Expected current persistence authority');
        }
        if (!currentSnapshot.bundle) {
            throw new Error('Expected the current persistence bundle');
        }
        await loadContextSnapshot({ context: first, snapshot: currentSnapshot });
        first.repository.automergeRepository.removeDoc('branch_stale');
        const deletionPersist = first.queue.runCrdtPersistenceOperation('compact');
        const deletionTransaction = await persistence.waitForTransaction('readwrite', 3);
        deletionTransaction.complete();
        await deletionPersist;

        second.repository.automergeRepository.changeDoc('branch_stale', (doc: Record<string, unknown>) => {
            doc.staleIncrementalEdit = true;
        });
        const stalePersist = second.queue.runCrdtPersistenceOperation('incremental');
        const firstAttempt = await finishConflictAttempt({
            persistence,
            operation: stalePersist,
            conflictOccurrence: 4,
        });

        const retry = await runRetryAttempt({
            persistence,
            operation: second.queue.runCrdtPersistenceOperation('incremental'),
        });

        expect(firstAttempt.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
        expect(firstAttempt.unexpectedWrites).toEqual([]);
        expect(retry.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
        expect(retry.writes).toEqual([]);
        await expectDurableDocumentPresence({ context: first, documentId: 'branch_stale', present: false });
    });

    it.each([
        { localChange: 'deletion' as const, expectedPresent: true },
        { localChange: 'addition' as const, expectedPresent: false },
    ])('rejects a local $localChange against a remote content commit', async ({ localChange, expectedPresent }) => {
        const documentId = localChange === 'deletion' ? 'shared_child' : 'local_only';
        const { first, second } = await createSharedContexts({
            persistence,
            documentIds: localChange === 'deletion' ? [documentId] : [],
        });

        first.repository.automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.remoteContentEdit = true;
        });
        const remotePersist = first.queue.runCrdtPersistenceOperation('compact');
        const remoteTransaction = await persistence.waitForTransaction('readwrite', 2);
        remoteTransaction.complete();
        await remotePersist;

        if (localChange === 'deletion') {
            second.repository.automergeRepository.removeDoc(documentId);
        } else {
            second.repository.automergeRepository.createChildDoc(documentId);
        }
        const localPersist = second.queue.runCrdtPersistenceOperation('compact');
        const attempt = await finishConflictAttempt({
            persistence,
            operation: localPersist,
            conflictOccurrence: 3,
        });

        expect(attempt.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
        expect(attempt.unexpectedWrites).toEqual([]);
        await expectDurableDocumentPresence({
            context: first,
            documentId,
            present: expectedPresent,
            expectedRoot: { remoteContentEdit: true },
        });
    });
});

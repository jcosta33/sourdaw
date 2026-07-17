import { clone as cloneDoc } from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type CrdtPersistenceSnapshot } from '../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb';
import { PERSISTENCE_AUTHORITY_KEY } from '../../repositories/crdtPersistence/persistenceAuthorityModel';
import { TransactionalPersistence } from '../../testing/transactionalPersistence';

const mocks = vi.hoisted(() => ({
    openDatabase: vi.fn(),
}));

vi.mock('../../repositories/crdtPersistence/helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: mocks.openDatabase,
}));
vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    flushAutomergeStorageWrites: vi.fn(),
}));
vi.mock('#/utils/HMR/createHmrPersistentState', () => ({
    createHmrPersistentState: <State>(_key: string, factory: () => State): State => factory(),
}));

type PersistenceContext = {
    queue: {
        runCrdtPersistenceOperation: typeof import('../runCrdtPersistenceOperation').runCrdtPersistenceOperation;
        runCrdtPersistenceLoad: typeof import('../runCrdtPersistenceLoad').runCrdtPersistenceLoad;
    };
    repository: typeof import('../../repositories/automergeRepository');
    snapshot: typeof import('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb');
};

type OperationOutcome = { kind: 'resolved' } | { kind: 'rejected'; error: unknown };

type ConflictAttempt = {
    error: unknown;
    unexpectedWrites: readonly import('../../testing/transactionalPersistence').TransactionWrite[];
};

async function importContext(): Promise<PersistenceContext> {
    vi.resetModules();
    const [operationQueue, loadQueue, repository, snapshot] = await Promise.all([
        import('../runCrdtPersistenceOperation'),
        import('../runCrdtPersistenceLoad'),
        import('../../repositories/automergeRepository'),
        import('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb'),
    ]);
    return {
        queue: {
            runCrdtPersistenceOperation: operationQueue.runCrdtPersistenceOperation,
            runCrdtPersistenceLoad: loadQueue.runCrdtPersistenceLoad,
        },
        repository,
        snapshot,
    };
}

async function loadContextSnapshot({
    context,
    snapshot,
}: {
    context: PersistenceContext;
    snapshot: CrdtPersistenceSnapshot;
}): Promise<void> {
    const bundle = snapshot.bundle;
    if (!bundle) {
        throw new Error('Expected a snapshot bundle to load');
    }
    const loaded = await context.queue.runCrdtPersistenceLoad(async ({ shouldCommit }) => {
        const committed = await context.repository.automergeRepository.loadAll({
            bundle,
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
}): Promise<{ error: unknown; writes: readonly import('../../testing/transactionalPersistence').TransactionWrite[] }> {
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
        expect(finalSnapshot.authority).toEqual({ epoch: '', revision: 3, rootLineage: 'main' });
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

    it.each(['incremental', 'compact'] as const)(
        'rejects a stale Feature root during $0 persistence after another context switches to Main',
        async (operation) => {
            const first = await importContext();
            const second = await importContext();
            const firstRepository = first.repository.automergeRepository;

            firstRepository.createProject('project');
            firstRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.sharedBeforeFork = true;
            });

            const mainPersist = first.queue.runCrdtPersistenceOperation('compact');
            const mainTransaction = await persistence.waitForTransaction('readwrite', 1);
            mainTransaction.complete();
            await mainPersist;

            const forkPoint = firstRepository.getDoc('root');
            if (!forkPoint) {
                throw new Error('Expected the fork point');
            }
            void first.queue.runCrdtPersistenceOperation({
                type: 'root-lineage-transition',
                from: 'main',
                to: 'feature',
            });
            firstRepository.insertDoc('branch_main', cloneDoc(forkPoint));
            firstRepository.insertDoc('branch_feature', cloneDoc(forkPoint));
            firstRepository.replaceDoc('root', cloneDoc(forkPoint));
            firstRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.featureBeforeSwitch = true;
            });
            firstRepository.replaceDoc('branch_feature', cloneDoc(firstRepository.getDoc('root')!));

            const featurePersist = first.queue.runCrdtPersistenceOperation('compact');
            const featureTransaction = await persistence.waitForTransaction('readwrite', 2);
            featureTransaction.complete();
            await featurePersist;

            const featureSnapshot = await first.snapshot.loadPersistenceSnapshotFromIdb();
            if (!featureSnapshot?.bundle) {
                throw new Error('Expected the durable Feature snapshot');
            }
            await loadContextSnapshot({ context: second, snapshot: featureSnapshot });

            const mainBacking = firstRepository.getDoc('branch_main');
            if (!mainBacking) {
                throw new Error('Expected the Main backing document');
            }
            void first.queue.runCrdtPersistenceOperation({
                type: 'root-lineage-transition',
                from: 'feature',
                to: 'main',
            });
            firstRepository.replaceDoc('branch_feature', cloneDoc(firstRepository.getDoc('root')!));
            firstRepository.replaceDoc('root', cloneDoc(mainBacking));
            firstRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.mainAfterSwitch = true;
            });

            const switchedMainPersist = first.queue.runCrdtPersistenceOperation('compact');
            const switchedMainTransaction = await persistence.waitForTransaction('readwrite', 3);
            switchedMainTransaction.complete();
            await switchedMainPersist;

            second.repository.automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.staleFeatureEdit = true;
            });
            const stalePersist = second.queue.runCrdtPersistenceOperation(operation);
            const attempt = await finishConflictAttempt({
                persistence,
                operation: stalePersist,
                conflictOccurrence: 4,
            });

            expect(attempt.error).toMatchObject({ _tag: 'CrdtPersistenceRootLineageConflict' });
            expect(attempt.unexpectedWrites).toEqual([]);
            const writeCountAfterConflict = persistence.getTransactions('readwrite').length;
            await expect(second.queue.runCrdtPersistenceOperation('compact')).rejects.toMatchObject({
                _tag: 'CrdtPersistenceRootLineageConflict',
            });
            expect(persistence.getTransactions('readwrite')).toHaveLength(writeCountAfterConflict);

            const durableMain = await first.snapshot.loadPersistenceSnapshotFromIdb();
            if (!durableMain?.bundle) {
                throw new Error('Expected the durable Main snapshot');
            }
            await loadContextSnapshot({ context: second, snapshot: durableMain });
            expect(second.repository.automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                sharedBeforeFork: true,
                mainAfterSwitch: true,
            });
            expect(second.repository.automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty(
                'staleFeatureEdit'
            );

            const reload = await importContext();
            await reload.repository.automergeRepository.loadAll({
                bundle: durableMain.bundle,
                shouldCommit: () => true,
            });
            expect(reload.repository.automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                sharedBeforeFork: true,
                mainAfterSwitch: true,
            });
            expect(reload.repository.automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty(
                'staleFeatureEdit'
            );
        }
    );

    it('serializes back-to-back lineage transitions after the first full snapshot commits', async () => {
        const context = await importContext();
        const repository = context.repository.automergeRepository;

        repository.createProject('project');
        repository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.mainBeforeFeature = true;
        });
        const mainDoc = repository.getDoc('root');
        if (!mainDoc) {
            throw new Error('Expected the Main root');
        }
        const mainSnapshot = cloneDoc(mainDoc);

        const mainPersist = context.queue.runCrdtPersistenceOperation('compact');
        const mainTransaction = await persistence.waitForTransaction('readwrite', 1);
        mainTransaction.complete();
        await mainPersist;

        await context.queue.runCrdtPersistenceOperation({
            type: 'root-lineage-transition',
            from: 'main',
            to: 'feature',
        });
        repository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.featureEdit = true;
        });
        const featurePersist = context.queue.runCrdtPersistenceOperation('compact');
        const featureTransaction = await persistence.waitForTransaction('readwrite', 2);

        // IndexedDB has committed Feature, but its promise continuation has not
        // yet adopted that authority when the user immediately returns to Main.
        featureTransaction.complete();
        await context.queue.runCrdtPersistenceOperation({
            type: 'root-lineage-transition',
            from: 'feature',
            to: 'main',
        });
        repository.replaceDoc('root', cloneDoc(mainSnapshot));
        repository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.mainAfterReturn = true;
        });
        const returnToMainPersist = context.queue.runCrdtPersistenceOperation('compact');
        await featurePersist;

        const returnToMainTransaction = await persistence.waitForTransaction('readwrite', 3);
        expect(returnToMainTransaction.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
        returnToMainTransaction.complete();
        await returnToMainPersist;

        const durableMain = await context.snapshot.loadPersistenceSnapshotFromIdb();
        expect(durableMain?.authority.rootLineage).toBe('main');
        if (!durableMain?.bundle) {
            throw new Error('Expected the durable Main bundle');
        }
        repository.reset();
        await repository.loadAll({ bundle: durableMain.bundle, shouldCommit: () => true });
        expect(repository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            mainBeforeFeature: true,
            mainAfterReturn: true,
        });
        expect(repository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('featureEdit');
    });

    it('migrates a legacy authority to conservative Main in the next atomic full snapshot', async () => {
        const context = await importContext();
        const repository = context.repository.automergeRepository;
        repository.createProject('legacy-project');
        repository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.legacyContent = true;
        });
        const legacyBundle = repository.saveAll();
        const legacyRoot = legacyBundle.get('root');
        if (!legacyRoot) {
            throw new Error('Expected the legacy root bytes');
        }
        persistence.seed('root', legacyRoot);
        persistence.seed(
            PERSISTENCE_AUTHORITY_KEY,
            new TextEncoder().encode(JSON.stringify({ version: 1, epoch: 'legacy-project', revision: 7 }))
        );
        repository.reset();

        const legacySnapshot = await context.snapshot.loadPersistenceSnapshotFromIdb();
        expect(legacySnapshot?.authority).toEqual({
            epoch: 'legacy-project',
            revision: 7,
            rootLineage: 'main',
        });
        if (!legacySnapshot?.bundle) {
            throw new Error('Expected the legacy persistence bundle');
        }
        await loadContextSnapshot({ context, snapshot: legacySnapshot });
        repository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.afterMigration = true;
        });

        const migrationPersist = context.queue.runCrdtPersistenceOperation('compact');
        const migrationTransaction = await persistence.waitForTransaction('readwrite', 1);
        const authorityWrite = migrationTransaction.writes.find(
            (write) => write.kind === 'put' && write.key === PERSISTENCE_AUTHORITY_KEY
        );
        expect(authorityWrite).toBeDefined();
        expect(JSON.parse(new TextDecoder().decode(authorityWrite?.value))).toMatchObject({
            version: 2,
            epoch: 'legacy-project',
            revision: 8,
            rootLineage: 'main',
        });
        migrationTransaction.complete();
        await migrationPersist;

        const migratedSnapshot = await context.snapshot.loadPersistenceSnapshotFromIdb();
        expect(migratedSnapshot?.authority).toEqual({
            epoch: 'legacy-project',
            revision: 8,
            rootLineage: 'main',
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

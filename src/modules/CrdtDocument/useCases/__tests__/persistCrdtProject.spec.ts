import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { type DocumentBundle } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';
import { loadAllFromIdb } from '../../repositories/crdtPersistence/loadAllFromIdb';
import { PERSISTENCE_AUTHORITY_KEY } from '../../repositories/crdtPersistence/persistenceAuthorityModel';
import { saveAllToIdb } from '../../repositories/crdtPersistence/saveAllToIdb';
import { TransactionalPersistence } from '../../testing/transactionalPersistence';
import { compactProject } from '../compactProject';
import { crdtProjectCompactionState } from '../crdtProjectCompactionState';
import { createCrdtProject } from '../createCrdtProject';
import { persistCrdtProject } from '../persistCrdtProject';
import { runCrdtPersistenceOperation } from '../runCrdtPersistenceOperation';

type VersionedQueueState = {
    version: number;
    persistenceGeneration: number;
    pendingChunks: unknown;
    pendingFullSnapshot: unknown;
    persistedBaseDocIds: Set<unknown>;
};

type PersistenceOperationOutcome = { kind: 'resolved' } | { kind: 'rejected'; error: unknown };

function isVersionedQueueState(value: unknown): value is VersionedQueueState {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    if (
        !('version' in value) ||
        !('persistenceGeneration' in value) ||
        !('pendingChunks' in value) ||
        !('pendingFullSnapshot' in value) ||
        !('persistedBaseDocIds' in value)
    ) {
        return false;
    }
    return (
        typeof value.version === 'number' &&
        typeof value.persistenceGeneration === 'number' &&
        Array.isArray(value.pendingChunks) &&
        value.persistedBaseDocIds instanceof Set
    );
}

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

vi.stubGlobal(
    'Worker',
    class UnavailableWorker {
        constructor() {
            throw new Error('worker unavailable in persistence test');
        }
    }
);

async function readBundle(
    persistence: TransactionalPersistence,
    occurrence: number
): Promise<Awaited<ReturnType<typeof loadAllFromIdb>>> {
    const load = loadAllFromIdb();
    const transaction = await persistence.waitForTransaction('readonly', occurrence);
    transaction.complete();
    return load;
}

function getPersistedDocumentKeys(persistence: TransactionalPersistence): string[] {
    return [...persistence.records.keys()].filter((key) => key !== PERSISTENCE_AUTHORITY_KEY);
}

async function readCurrentBundle(
    persistence: TransactionalPersistence
): Promise<Awaited<ReturnType<typeof loadAllFromIdb>>> {
    return readBundle(persistence, persistence.getTransactions('readonly').length + 1);
}

async function commitRemoteBundle({
    bundle,
    persistence,
    nextRootLineage,
}: {
    bundle: DocumentBundle;
    persistence: TransactionalPersistence;
    nextRootLineage?: string;
}): Promise<void> {
    const occurrence = persistence.getTransactions('readwrite').length + 1;
    const options = nextRootLineage === undefined ? {} : { nextRootLineage };
    const save = saveAllToIdb(bundle, options);
    const transaction = await persistence.waitForTransaction('readwrite', occurrence);
    transaction.complete();
    await expect(save).resolves.toMatchObject({ status: 'committed' });
}

async function importPersistenceAfterQueueVersionMismatch(): Promise<typeof import('../persistCrdtProject')> {
    const capturedStates: unknown[] = [];
    vi.resetModules();
    vi.doMock('#/utils/HMR/createHmrPersistentState', () => ({
        createHmrPersistentState: <State>(key: string, factory: () => State): State => {
            const state = createHmrPersistentState(key, factory);
            capturedStates.push(state);
            return state;
        },
    }));
    vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
    await import('../persistCrdtProject');

    const state = capturedStates[capturedStates.length - 1];
    if (!isVersionedQueueState(state)) {
        throw new Error('Expected the queue HMR state holder');
    }
    state.version = 0;

    vi.resetModules();
    return import('../persistCrdtProject');
}

async function settleOperationCapturingWrites({
    firstWriteOccurrence,
    operation,
    persistence,
}: {
    firstWriteOccurrence: number;
    operation: Promise<void>;
    persistence: TransactionalPersistence;
}): Promise<{ error: unknown; writes: readonly import('../../testing/transactionalPersistence').TransactionWrite[] }> {
    const outcomePromise: Promise<PersistenceOperationOutcome> = operation.then(
        () => ({ kind: 'resolved' }),
        (error: unknown) => ({ kind: 'rejected', error })
    );
    const writes: import('../../testing/transactionalPersistence').TransactionWrite[] = [];
    let occurrence = firstWriteOccurrence;

    for (let attempt = 0; attempt < 4; attempt++) {
        const result = await Promise.race([
            outcomePromise,
            persistence
                .waitForTransaction('readwrite', occurrence)
                .then((transaction) => ({ kind: 'transaction' as const, transaction })),
        ]);
        if (result.kind !== 'transaction') {
            return {
                error: result.kind === 'rejected' ? result.error : null,
                writes,
            };
        }

        writes.push(...result.transaction.writes);
        result.transaction.abort();
        occurrence++;
    }

    throw new Error('Persistence operation did not settle after four aborted writes');
}

describe('persistCrdtProject', () => {
    let persistence: TransactionalPersistence;

    beforeEach(() => {
        vi.clearAllMocks();
        persistence = new TransactionalPersistence();
        mocks.openDatabase.mockResolvedValue(persistence.database);
        automergeRepository.reset();
        void runCrdtPersistenceOperation('reset');
        crdtProjectCompactionState.incrementalSaveCount = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('retains exact Automerge bytes across repeated aborts, reloads them, and persists the next delta once', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.firstEdit = 'retained';
        });
        const saveIncrementalSpy = vi.spyOn(automergeRepository, 'saveDocIncremental');

        const firstAttempt = persistCrdtProject();
        const firstTransaction = await persistence.waitForTransaction('readwrite', 2);
        const firstChunk = firstTransaction.writes.find((write) => write.kind === 'add');
        expect(firstChunk).toBeDefined();
        firstTransaction.abort();
        await expect(firstAttempt).rejects.toThrow('IDB transaction aborted');
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
        expect(saveIncrementalSpy).toHaveBeenCalledOnce();

        const secondAttempt = persistCrdtProject();
        const secondTransaction = await persistence.waitForTransaction('readwrite', 3);
        const secondChunk = secondTransaction.writes.find((write) => write.kind === 'add');
        expect(secondChunk?.value).toEqual(firstChunk?.value);
        secondTransaction.abort();
        await expect(secondAttempt).rejects.toThrow('IDB transaction aborted');
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
        expect(saveIncrementalSpy).toHaveBeenCalledOnce();

        const successfulRetry = persistCrdtProject();
        const retryTransaction = await persistence.waitForTransaction('readwrite', 4);
        const retryChunk = retryTransaction.writes.find((write) => write.kind === 'add');
        expect(retryChunk?.value).toEqual(firstChunk?.value);
        retryTransaction.complete();
        await successfulRetry;
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(1);
        expect(saveIncrementalSpy).toHaveBeenCalledTimes(2);

        const noDeltaPersist = persistCrdtProject();
        await noDeltaPersist;
        expect(persistence.getTransactions('readwrite')).toHaveLength(4);
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(1);

        const firstBundle = await readBundle(persistence, 1);
        if (!firstBundle) {
            throw new Error('Expected a full base plus retained incremental');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle: firstBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            firstEdit: 'retained',
        });

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.secondEdit = 'survives-once';
        });
        const secondDeltaPersist = persistCrdtProject();
        const secondDeltaTransaction = await persistence.waitForTransaction('readwrite', 5);
        secondDeltaTransaction.complete();
        await secondDeltaPersist;
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(2);

        const finalBundle = await readBundle(persistence, 2);
        if (!finalBundle) {
            throw new Error('Expected the subsequent delta to persist');
        }
        const incrementals = [...finalBundle.keys()].filter((key) => key.startsWith('root:incremental:'));
        expect(incrementals).toHaveLength(2);

        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle: finalBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            firstEdit: 'retained',
            secondEdit: 'survives-once',
        });
    });

    it('persists a child-only edit with exact retained bytes across an IDB abort and reloads it once', async () => {
        automergeRepository.createProject('project');
        automergeRepository.createChildDoc('child-1');
        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.baseline = true;
        });

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.childOnlyEdit = 'survives-reload';
        });

        const firstAttempt = persistCrdtProject();
        const firstTransaction = await Promise.race([
            persistence.waitForTransaction('readwrite', 2),
            firstAttempt.then(() => {
                throw new Error('Child-only persistence completed without an IDB transaction');
            }),
        ]);
        const firstChunk = firstTransaction.writes.find(
            (write) => write.kind === 'add' && write.key.startsWith('child-1:incremental:')
        );
        expect(firstChunk).toBeDefined();
        expect(firstTransaction.writes.filter((write) => write.kind === 'add')).toHaveLength(1);
        firstTransaction.abort();
        await expect(firstAttempt).rejects.toThrow('IDB transaction aborted');

        const retryAttempt = persistCrdtProject();
        const retryTransaction = await persistence.waitForTransaction('readwrite', 3);
        const retryChunk = retryTransaction.writes.find(
            (write) => write.kind === 'add' && write.key.startsWith('child-1:incremental:')
        );
        expect(retryChunk?.value).toEqual(firstChunk?.value);
        retryTransaction.complete();
        await retryAttempt;

        const persistedChildChunks = [...persistence.records.entries()].filter(([key]) =>
            key.startsWith('child-1:incremental:')
        );
        expect(persistedChildChunks).toHaveLength(1);
        expect(persistedChildChunks[0]?.[1]).toEqual(firstChunk?.value);

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the root and child baseline plus the child incremental');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('child-1')).toMatchObject({
            baseline: true,
            childOnlyEdit: 'survives-reload',
        });
    });

    it('persists a newly created child after the last full snapshot with a reloadable base', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.createChildDoc('new-child');
        automergeRepository.changeDoc('new-child', (doc: Record<string, unknown>) => {
            doc.createdAfterSnapshot = true;
        });

        const persist = persistCrdtProject();
        const childBaseSave = await persistence.waitForTransaction('readwrite', 2);
        expect(childBaseSave.writes.some((write) => write.kind === 'put' && write.key === 'new-child')).toBe(true);
        childBaseSave.complete();
        await persist;

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the post-snapshot child to be persisted');
        }
        expect(bundle.has('new-child')).toBe(true);

        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('new-child')).toMatchObject({
            createdAfterSnapshot: true,
        });
    });

    it('persists all current document chunks atomically in deterministic document-id order', async () => {
        automergeRepository.createProject('project');
        automergeRepository.createChildDoc('child-1');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.rootBaseline = true;
        });
        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.childBaseline = true;
        });

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.rootEdit = true;
        });
        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.childEdit = true;
        });

        const firstAttempt = persistCrdtProject();
        const firstTransaction = await persistence.waitForTransaction('readwrite', 2);
        const firstChunks = firstTransaction.writes.filter((write) => write.kind === 'add');
        expect(firstChunks.map((write) => write.key.split(':incremental:')[0])).toEqual(['child-1', 'root']);
        firstTransaction.abort();
        await expect(firstAttempt).rejects.toThrow('IDB transaction aborted');
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
        expect(getPersistedDocumentKeys(persistence).sort()).toEqual(['child-1', 'root']);

        const retryAttempt = persistCrdtProject();
        const retryTransaction = await persistence.waitForTransaction('readwrite', 3);
        const retryChunks = retryTransaction.writes.filter((write) => write.kind === 'add');
        expect(retryChunks.map((write) => write.key.split(':incremental:')[0])).toEqual(['child-1', 'root']);
        expect(retryChunks.map((write) => write.value)).toEqual(firstChunks.map((write) => write.value));
        retryTransaction.complete();
        await retryAttempt;

        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(2);
        expect([...persistence.records.keys()].filter((key) => key.includes(':incremental:'))).toHaveLength(2);
    });

    it('keeps edits that arrive while an incremental batch is in flight for the next persist', async () => {
        automergeRepository.createProject('project');
        automergeRepository.createChildDoc('child-1');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.firstRootEdit = true;
        });
        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.firstChildEdit = true;
        });

        const firstPersist = persistCrdtProject();
        const firstTransaction = await persistence.waitForTransaction('readwrite', 2);
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.secondRootEdit = true;
        });
        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.secondChildEdit = true;
        });
        firstTransaction.complete();
        await firstPersist;

        const secondPersist = persistCrdtProject();
        const secondTransaction = await persistence.waitForTransaction('readwrite', 3);
        expect(secondTransaction.writes.filter((write) => write.kind === 'add')).toHaveLength(2);
        secondTransaction.complete();
        await secondPersist;

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected edits from both incremental batches');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            firstRootEdit: true,
            secondRootEdit: true,
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('child-1')).toMatchObject({
            firstChildEdit: true,
            secondChildEdit: true,
        });
    });

    it('drops a failed child chunk before full compaction so a removed document cannot return', async () => {
        automergeRepository.createProject('project');
        automergeRepository.createChildDoc('child-1');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.removedEdit = true;
        });
        const failedPersist = persistCrdtProject();
        const failedIncremental = await persistence.waitForTransaction('readwrite', 2);
        expect(failedIncremental.writes.some((write) => write.key.startsWith('child-1:incremental:'))).toBe(true);
        failedIncremental.abort();
        await expect(failedPersist).rejects.toThrow('IDB transaction aborted');

        automergeRepository.removeDoc('child-1');
        const compaction = compactProject();
        const fullSave = await persistence.waitForTransaction('readwrite', 3);
        expect(fullSave.writes.some((write) => write.key === 'child-1')).toBe(false);
        fullSave.complete();
        await compaction;

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the remaining root document');
        }
        expect(bundle.has('child-1')).toBe(false);
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc('child-1')).toBeUndefined();
    });

    it('supersedes an obsolete failed full snapshot before retrying a removed document', async () => {
        automergeRepository.createProject('project');
        automergeRepository.createChildDoc('child-1');
        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.beforeFailedSnapshot = true;
        });

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('child-1', (doc: Record<string, unknown>) => {
            doc.failedSnapshotEdit = true;
        });
        const failedCompaction = compactProject();
        const failedFullSave = await persistence.waitForTransaction('readwrite', 2);
        expect(failedFullSave.writes.some((write) => write.key === 'child-1')).toBe(true);
        failedFullSave.abort();
        await expect(failedCompaction).rejects.toThrow('IDB transaction aborted');

        automergeRepository.removeDoc('child-1');
        const retry = persistCrdtProject();
        const currentFullSave = await persistence.waitForTransaction('readwrite', 3);
        expect(currentFullSave.writes.some((write) => write.key === 'child-1')).toBe(false);
        expect(currentFullSave.writes.some((write) => write.key === 'root')).toBe(true);
        currentFullSave.complete();
        await retry;

        expect(persistence.getTransactions('readwrite')).toHaveLength(3);
        expect(getPersistedDocumentKeys(persistence)).toEqual(['root']);
    });

    it('does not let an old-generation incremental completion overwrite a new project', async () => {
        automergeRepository.createProject('old-project');
        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.oldEdit = true;
        });
        const oldPersist = persistCrdtProject();
        const oldIncremental = await persistence.waitForTransaction('readwrite', 2);

        await runCrdtPersistenceOperation('reset');
        expect(oldIncremental.isAbortRequested()).toBe(true);
        automergeRepository.createProject('new-project');
        const newProjectCompaction = compactProject();

        await expect(oldPersist).resolves.toBeUndefined();

        const newProjectSave = await persistence.waitForTransaction('readwrite', 3);
        expect(newProjectSave.writes.some((write) => write.kind === 'add')).toBe(false);
        expect(newProjectSave.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
        newProjectSave.complete();
        await newProjectCompaction;

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the new project root');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('oldEdit');
    });

    it('drops failed outgoing chunks before a new-project compaction and keeps the new root writable', async () => {
        automergeRepository.createProject('old-project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.oldEdit = true;
        });
        const failedPersist = persistCrdtProject();
        const failedTransaction = await persistence.waitForTransaction('readwrite', 2);
        failedTransaction.abort();
        await expect(failedPersist).rejects.toThrow('IDB transaction aborted');

        const newProject = createCrdtProject('new-project');
        const newProjectSave = await persistence.waitForTransaction('readwrite', 3);
        expect(newProjectSave.writes.some((write) => write.kind === 'add')).toBe(false);
        newProjectSave.complete();
        await newProject;
        expect(getPersistedDocumentKeys(persistence)).toEqual(['root']);

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.newEdit = true;
        });
        const newPersist = persistCrdtProject();
        const newIncremental = await persistence.waitForTransaction('readwrite', 4);
        newIncremental.complete();
        await newPersist;

        const finalBundle = await readBundle(persistence, 1);
        if (!finalBundle) {
            throw new Error('Expected the new project bundle');
        }
        expect([...finalBundle.keys()].filter((key) => key.startsWith('root:incremental:'))).toHaveLength(1);

        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle: finalBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ newEdit: true });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('oldEdit');
    });

    it('does not let a superseded empty load strand reset authority or later autosaves', async () => {
        let resolveEmptySnapshot: (value: {
            authority: { epoch: string; revision: number; rootLineage: string };
            bundle: null;
        }) => void = () => undefined;
        const emptySnapshot = new Promise<{
            authority: { epoch: string; revision: number; rootLineage: string };
            bundle: null;
        }>((resolve) => {
            resolveEmptySnapshot = resolve;
        });
        let loadIsCurrent = true;
        let staleLoad: Promise<boolean> | null = null;
        let autosave: Promise<void> | null = null;

        try {
            vi.resetModules();
            vi.doMock('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb', () => ({
                loadPersistenceSnapshotFromIdb: () => emptySnapshot,
            }));
            vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
            const { loadCrdtProject: loadWithDeferredEmptySnapshot } = await import('../loadCrdtProject');

            staleLoad = loadWithDeferredEmptySnapshot({ shouldCommit: () => loadIsCurrent });
            loadIsCurrent = false;

            await runCrdtPersistenceOperation('reset');
            automergeRepository.createProject('replacement');
            const replacementCompaction = compactProject();
            const replacementSave = await persistence.waitForTransaction('readwrite', 1);
            replacementSave.complete();
            await replacementCompaction;

            resolveEmptySnapshot({ authority: { epoch: '', revision: 0, rootLineage: 'main' }, bundle: null });
            await expect(staleLoad).resolves.toBe(false);

            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.afterSupersededLoad = true;
            });
            autosave = persistCrdtProject();
            const autosaveTransaction = await persistence.waitForTransaction('readwrite', 2);
            autosaveTransaction.complete();
            await expect(autosave).resolves.toBeUndefined();
            expect(autosaveTransaction.writes.some((write) => write.kind === 'add')).toBe(true);

            const finalBundle = await readCurrentBundle(persistence);
            if (!finalBundle) {
                throw new Error('Expected the replacement project with its later edit');
            }
            automergeRepository.reset();
            await expect(automergeRepository.loadAll({ bundle: finalBundle, shouldCommit: () => true })).resolves.toBe(
                true
            );
            expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                afterSupersededLoad: true,
            });
        } finally {
            resolveEmptySnapshot({ authority: { epoch: '', revision: 0, rootLineage: 'main' }, bundle: null });
            await staleLoad?.catch(() => undefined);
            await autosave?.catch(() => undefined);
            for (const transaction of persistence.getTransactions('readwrite')) {
                if (!transaction.isSettled()) {
                    transaction.abort();
                }
            }
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb');
            vi.resetModules();
        }
    });

    it('survives queue module replacement after an aborted incremental transaction', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.beforeHmr = true;
        });

        const failedPersist = persistCrdtProject();
        const failedIncremental = await persistence.waitForTransaction('readwrite', 2);
        const failedChunk = failedIncremental.writes.find((write) => write.kind === 'add');
        expect(failedChunk).toBeDefined();
        failedIncremental.abort();
        await expect(failedPersist).rejects.toThrow('IDB transaction aborted');

        try {
            vi.resetModules();
            vi.doMock('#/utils/HMR/createHmrPersistentState', () => ({ createHmrPersistentState }));
            vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
            const { persistCrdtProject: persistAfterHmr } = await import('../persistCrdtProject');

            const retry = persistAfterHmr();
            const retryTransaction = await Promise.race([
                persistence.waitForTransaction('readwrite', 3),
                retry.then(() => {
                    throw new Error('HMR queue replacement lost the pending incremental bytes');
                }),
            ]);
            const retryChunk = retryTransaction.writes.find((write) => write.kind === 'add');
            expect(retryChunk?.value).toEqual(failedChunk?.value);
            retryTransaction.complete();
            await retry;
        } finally {
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the pending incremental bytes to survive queue HMR');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ beforeHmr: true });
    });

    it('survives queue module replacement after an aborted full snapshot transaction', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.beforeFullHmr = true;
        });
        const failedCompaction = compactProject();
        const failedFullSave = await persistence.waitForTransaction('readwrite', 2);
        const failedRoot = failedFullSave.writes.find((write) => write.kind === 'put' && write.key === 'root');
        expect(failedRoot).toBeDefined();
        failedFullSave.abort();
        await expect(failedCompaction).rejects.toThrow('IDB transaction aborted');

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.afterFullHmr = true;
        });

        try {
            vi.resetModules();
            vi.doMock('#/utils/HMR/createHmrPersistentState', () => ({ createHmrPersistentState }));
            vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
            const { compactProject: compactAfterHmr } = await import('../compactProject');

            const retry = compactAfterHmr();
            const retrySave = await Promise.race([
                persistence.waitForTransaction('readwrite', 3),
                retry.then(() => {
                    throw new Error('HMR queue replacement lost the pending full snapshot bytes');
                }),
            ]);
            const retryRoot = retrySave.writes.find((write) => write.kind === 'put' && write.key === 'root');
            expect(retryRoot?.value).toEqual(failedRoot?.value);
            retrySave.complete();

            const currentSave = await persistence.waitForTransaction('readwrite', 4);
            expect(currentSave.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
            currentSave.complete();
            await retry;
        } finally {
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the pending full snapshot bytes to survive queue HMR');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            beforeFullHmr: true,
            afterFullHmr: true,
        });
    });

    it('shares an in-flight incremental completion with the replacement queue module', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.inFlightHmr = true;
        });
        const firstPersist = persistCrdtProject();
        const firstIncremental = await persistence.waitForTransaction('readwrite', 2);
        const firstChunk = firstIncremental.writes.find((write) => write.kind === 'add');
        expect(firstChunk).toBeDefined();

        try {
            vi.resetModules();
            vi.doMock('#/utils/HMR/createHmrPersistentState', () => ({ createHmrPersistentState }));
            vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
            const { persistCrdtProject: persistAfterHmr } = await import('../persistCrdtProject');

            firstIncremental.abort();
            await expect(firstPersist).rejects.toThrow('IDB transaction aborted');

            const retry = persistAfterHmr();
            const retryTransaction = await Promise.race([
                persistence.waitForTransaction('readwrite', 3),
                retry.then(() => {
                    throw new Error('HMR queue replacement lost bytes when the old transaction settled');
                }),
            ]);
            const retryChunk = retryTransaction.writes.find((write) => write.kind === 'add');
            expect(retryChunk?.value).toEqual(firstChunk?.value);
            retryTransaction.complete();
            await retry;
        } finally {
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the in-flight incremental bytes to survive queue HMR');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ inFlightHmr: true });
    });

    it('merges the durable bundle before adopting authority during incompatible queue migration', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;
        const staleBundle = automergeRepository.saveAll();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.remoteMigrationEdit = true;
        });
        await commitRemoteBundle({ bundle: automergeRepository.saveAll(), persistence });

        await expect(automergeRepository.loadAll({ bundle: staleBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.localMigrationEdit = true;
        });

        try {
            const { persistCrdtProject: persistAfterMigration } = await importPersistenceAfterQueueVersionMismatch();
            const recovery = persistAfterMigration();
            const recoverySave = await persistence.waitForTransaction('readwrite', 3);
            expect(recoverySave.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
            recoverySave.complete();
            await recovery;

            const finalBundle = await readCurrentBundle(persistence);
            if (!finalBundle) {
                throw new Error('Expected the reconciled migration bundle');
            }
            automergeRepository.reset();
            await expect(automergeRepository.loadAll({ bundle: finalBundle, shouldCommit: () => true })).resolves.toBe(
                true
            );
            expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                localMigrationEdit: true,
                remoteMigrationEdit: true,
            });
        } finally {
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }
    });

    it('rejects a durable root lineage change during incompatible queue migration until reload', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;
        const staleMainBundle = automergeRepository.saveAll();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.remoteFeatureEdit = true;
        });
        await commitRemoteBundle({
            bundle: automergeRepository.saveAll(),
            persistence,
            nextRootLineage: 'feature',
        });
        await expect(automergeRepository.loadAll({ bundle: staleMainBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.staleMainEdit = true;
        });

        try {
            const { persistCrdtProject: persistAfterMigration } = await importPersistenceAfterQueueVersionMismatch();
            const firstAttempt = await settleOperationCapturingWrites({
                firstWriteOccurrence: 3,
                operation: persistAfterMigration(),
                persistence,
            });
            const retry = await settleOperationCapturingWrites({
                firstWriteOccurrence: 3,
                operation: persistAfterMigration(),
                persistence,
            });

            expect(firstAttempt.error).toMatchObject({ _tag: 'CrdtPersistenceRootLineageConflict' });
            expect(firstAttempt.writes).toEqual([]);
            expect(retry.error).toMatchObject({ _tag: 'CrdtPersistenceRootLineageConflict' });
            expect(retry.writes).toEqual([]);
            expect(persistence.getTransactions('readwrite')).toHaveLength(2);

            const { loadCrdtProject: reloadAfterConflict } = await import('../loadCrdtProject');
            await expect(reloadAfterConflict()).resolves.toBe(true);
            expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                remoteFeatureEdit: true,
            });
            expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('staleMainEdit');
        } finally {
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }
    });

    it('revokes an in-flight migration merge when a replacement project resets the queue', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;
        const staleBundle = automergeRepository.saveAll();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.remoteBeforeReplacement = true;
        });
        await commitRemoteBundle({ bundle: automergeRepository.saveAll(), persistence });
        await expect(automergeRepository.loadAll({ bundle: staleBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );

        let releaseMerge: () => void = () => undefined;
        const mergeGate = new Promise<void>((resolve) => {
            releaseMerge = resolve;
        });
        let markMergeStarted: (() => void) | null = null;
        const mergeStarted = new Promise<void>((resolve) => {
            markMergeStarted = resolve;
        });
        const mergeBundle = automergeRepository.mergeBundle.bind(automergeRepository);
        vi.spyOn(automergeRepository, 'mergeBundle').mockImplementation(async (bundle, options) => {
            markMergeStarted?.();
            await mergeGate;
            return mergeBundle(bundle, options);
        });

        try {
            await importPersistenceAfterQueueVersionMismatch();
            const queueAfterMigration = await import('../runCrdtPersistenceOperation');
            await mergeStarted;

            await queueAfterMigration.runCrdtPersistenceOperation('reset');
            automergeRepository.createProject('replacement');
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.replacementProject = true;
            });
            const replacementCompaction = queueAfterMigration.runCrdtPersistenceOperation('compact');
            releaseMerge();

            const replacementSave = await persistence.waitForTransaction('readwrite', 3);
            replacementSave.complete();
            await replacementCompaction;
            expect(persistence.getTransactions('readwrite')).toHaveLength(3);

            const finalBundle = await readCurrentBundle(persistence);
            if (!finalBundle) {
                throw new Error('Expected the replacement project bundle');
            }
            automergeRepository.reset();
            await expect(automergeRepository.loadAll({ bundle: finalBundle, shouldCommit: () => true })).resolves.toBe(
                true
            );
            expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                replacementProject: true,
            });
            expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty(
                'remoteBeforeReplacement'
            );
        } finally {
            releaseMerge();
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }
    });

    it.each(['addition', 'deletion'] as const)(
        'rejects a durable document $0 during incompatible queue migration and poisons retries',
        async (remoteMembershipChange) => {
            const documentId = `remote_${remoteMembershipChange}`;
            automergeRepository.createProject('project');
            if (remoteMembershipChange === 'deletion') {
                automergeRepository.createChildDoc(documentId);
            }

            const baseCompaction = compactProject();
            const baseSave = await persistence.waitForTransaction('readwrite', 1);
            baseSave.complete();
            await baseCompaction;
            const staleBundle = automergeRepository.saveAll();

            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.remoteMembershipEdit = remoteMembershipChange;
            });
            if (remoteMembershipChange === 'addition') {
                automergeRepository.createChildDoc(documentId);
            } else {
                automergeRepository.removeDoc(documentId);
            }
            await commitRemoteBundle({ bundle: automergeRepository.saveAll(), persistence });

            await expect(automergeRepository.loadAll({ bundle: staleBundle, shouldCommit: () => true })).resolves.toBe(
                true
            );
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.localStaleMembershipEdit = remoteMembershipChange;
            });
            expect(automergeRepository.hasDoc(documentId)).toBe(remoteMembershipChange === 'deletion');

            try {
                const { persistCrdtProject: persistAfterMigration } =
                    await importPersistenceAfterQueueVersionMismatch();
                const firstAttempt = await settleOperationCapturingWrites({
                    firstWriteOccurrence: 3,
                    operation: persistAfterMigration(),
                    persistence,
                });
                const retry = await settleOperationCapturingWrites({
                    firstWriteOccurrence: persistence.getTransactions('readwrite').length + 1,
                    operation: persistAfterMigration(),
                    persistence,
                });

                expect(firstAttempt.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
                expect(firstAttempt.writes).toEqual([]);
                expect(retry.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
                expect(retry.writes).toEqual([]);
                expect(automergeRepository.hasDoc(documentId)).toBe(remoteMembershipChange === 'deletion');
                expect(getPersistedDocumentKeys(persistence).sort()).toEqual(
                    remoteMembershipChange === 'addition' ? [documentId, 'root'].sort() : ['root']
                );

                const { loadCrdtProject: reloadAfterConflict } = await import('../loadCrdtProject');
                await expect(reloadAfterConflict()).resolves.toBe(true);
                expect(automergeRepository.hasDoc(documentId)).toBe(remoteMembershipChange === 'addition');

                const { compactProject: compactAfterReload } = await import('../compactProject');
                const postReloadCompaction = compactAfterReload();
                const postReloadSave = await persistence.waitForTransaction(
                    'readwrite',
                    persistence.getTransactions('readwrite').length + 1
                );
                expect(postReloadSave.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
                postReloadSave.complete();
                await postReloadCompaction;

                const finalBundle = await readCurrentBundle(persistence);
                if (!finalBundle) {
                    throw new Error('Expected the durable membership bundle to remain intact');
                }
                automergeRepository.reset();
                await expect(
                    automergeRepository.loadAll({ bundle: finalBundle, shouldCommit: () => true })
                ).resolves.toBe(true);
                expect(automergeRepository.hasDoc(documentId)).toBe(remoteMembershipChange === 'addition');
                expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                    remoteMembershipEdit: remoteMembershipChange,
                });
                expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty(
                    'localStaleMembershipEdit'
                );
            } finally {
                vi.doUnmock('../../repositories/automergeRepository');
                vi.doUnmock('#/utils/HMR/createHmrPersistentState');
                vi.resetModules();
            }
        }
    );

    it('rejects committed empty durable membership during incompatible queue migration', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;
        const staleBundle = automergeRepository.saveAll();

        automergeRepository.reset();
        await commitRemoteBundle({ bundle: new Map(), persistence });
        await expect(automergeRepository.loadAll({ bundle: staleBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.staleClearedProjectEdit = true;
        });

        try {
            const { persistCrdtProject: persistAfterMigration } = await importPersistenceAfterQueueVersionMismatch();
            const firstAttempt = await settleOperationCapturingWrites({
                firstWriteOccurrence: 3,
                operation: persistAfterMigration(),
                persistence,
            });
            const retry = await settleOperationCapturingWrites({
                firstWriteOccurrence: persistence.getTransactions('readwrite').length + 1,
                operation: persistAfterMigration(),
                persistence,
            });

            expect(firstAttempt.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
            expect(firstAttempt.writes).toEqual([]);
            expect(retry.error).toMatchObject({ _tag: 'CrdtPersistenceMembershipConflict' });
            expect(retry.writes).toEqual([]);
            expect(getPersistedDocumentKeys(persistence)).toEqual([]);
            await expect(readCurrentBundle(persistence)).resolves.toBeNull();
        } finally {
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }
    });

    it('recovers a current full bundle after incompatible queue migration aborts an in-flight incremental', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.beforeMigration = true;
        });

        const oldPersist = persistCrdtProject();
        const oldIncremental = await persistence.waitForTransaction('readwrite', 2);
        const oldChunk = oldIncremental.writes.find((write) => write.kind === 'add');
        expect(oldChunk).toBeDefined();

        const capturedStates: unknown[] = [];
        try {
            vi.resetModules();
            vi.doMock('#/utils/HMR/createHmrPersistentState', () => ({
                createHmrPersistentState: <State>(key: string, factory: () => State): State => {
                    const state = createHmrPersistentState(key, factory);
                    capturedStates.push(state);
                    return state;
                },
            }));
            vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
            await import('../persistCrdtProject');

            const state = capturedStates[capturedStates.length - 1];
            if (!isVersionedQueueState(state)) {
                throw new Error('Expected the queue HMR state holder');
            }
            state.pendingChunks = { stale: true };
            state.pendingFullSnapshot = { stale: true };
            state.version = 0;

            vi.resetModules();
            const { persistCrdtProject: persistAfterMigration } = await import('../persistCrdtProject');
            let recoverySettled = false;
            const recovery = persistAfterMigration().finally(() => {
                recoverySettled = true;
            });

            try {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                expect(recoverySettled).toBe(false);
                expect(persistence.getTransactions('readwrite')).toHaveLength(2);

                oldIncremental.abort();
                await expect(oldPersist).rejects.toThrow('IDB transaction aborted');

                const recoverySave = await persistence.waitForTransaction('readwrite', 3);
                expect(recoverySave.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
                expect(recoverySave.writes.some((write) => write.kind === 'add')).toBe(false);
                recoverySave.complete();
                await recovery;

                const bundle = await readBundle(persistence, 1);
                if (!bundle) {
                    throw new Error('Expected a recovered current full bundle');
                }
                automergeRepository.reset();
                await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
                expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                    beforeMigration: true,
                });
            } finally {
                if (!oldIncremental.isSettled()) {
                    oldIncremental.abort();
                }
                await oldPersist.catch(() => undefined);
                await recovery.catch(() => undefined);
            }
        } finally {
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }
    });

    it('orders migration recovery after a successful old write and replaces stale bytes with current state', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.beforeMigrationSuccess = true;
        });

        const oldPersist = persistCrdtProject();
        const oldIncremental = await persistence.waitForTransaction('readwrite', 2);
        expect(oldIncremental.writes.some((write) => write.kind === 'add')).toBe(true);

        const capturedStates: unknown[] = [];
        let recovery: Promise<void> | null = null;
        try {
            vi.resetModules();
            vi.doMock('#/utils/HMR/createHmrPersistentState', () => ({
                createHmrPersistentState: <State>(key: string, factory: () => State): State => {
                    const state = createHmrPersistentState(key, factory);
                    capturedStates.push(state);
                    return state;
                },
            }));
            vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
            await import('../persistCrdtProject');

            const state = capturedStates[capturedStates.length - 1];
            if (!isVersionedQueueState(state)) {
                throw new Error('Expected the queue HMR state holder');
            }
            state.pendingChunks = { stale: true };
            state.pendingFullSnapshot = { stale: true };
            state.version = 0;

            vi.resetModules();
            const { persistCrdtProject: persistAfterMigration } = await import('../persistCrdtProject');
            let recoverySettled = false;
            recovery = persistAfterMigration().finally(() => {
                recoverySettled = true;
            });

            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(recoverySettled).toBe(false);
            expect(persistence.getTransactions('readwrite')).toHaveLength(2);

            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.afterMigrationSuccess = true;
            });
            oldIncremental.complete();
            await oldPersist;

            const recoverySave = await persistence.waitForTransaction('readwrite', 3);
            expect(recoverySave.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
            expect(recoverySave.writes.some((write) => write.kind === 'add')).toBe(false);
            recoverySave.complete();
            await recovery;

            const bundle = await readBundle(persistence, 1);
            if (!bundle) {
                throw new Error('Expected the current full bundle after the old write');
            }
            expect([...bundle.keys()]).toEqual(['root']);
            automergeRepository.reset();
            await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
            expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                beforeMigrationSuccess: true,
                afterMigrationSuccess: true,
            });
        } finally {
            if (!oldIncremental.isSettled()) {
                oldIncremental.abort();
            }
            await oldPersist.catch(() => undefined);
            await recovery?.catch(() => undefined);
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }
    });

    it('retries a migration full recovery after its IndexedDB transaction aborts', async () => {
        automergeRepository.createProject('project');

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.migrationRetry = true;
        });

        const oldPersist = persistCrdtProject();
        const oldIncremental = await persistence.waitForTransaction('readwrite', 2);
        expect(oldIncremental.writes.some((write) => write.kind === 'add')).toBe(true);

        const capturedStates: unknown[] = [];
        let recovery: Promise<void> | null = null;
        try {
            vi.resetModules();
            vi.doMock('#/utils/HMR/createHmrPersistentState', () => ({
                createHmrPersistentState: <State>(key: string, factory: () => State): State => {
                    const state = createHmrPersistentState(key, factory);
                    capturedStates.push(state);
                    return state;
                },
            }));
            vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
            await import('../persistCrdtProject');

            const state = capturedStates[capturedStates.length - 1];
            if (!isVersionedQueueState(state)) {
                throw new Error('Expected the queue HMR state holder');
            }
            state.pendingChunks = { stale: true };
            state.pendingFullSnapshot = { stale: true };
            state.version = 0;

            vi.resetModules();
            const { persistCrdtProject: persistAfterMigration } = await import('../persistCrdtProject');
            recovery = persistAfterMigration();

            oldIncremental.abort();
            await expect(oldPersist).rejects.toThrow('IDB transaction aborted');

            const failedRecovery = await persistence.waitForTransaction('readwrite', 3);
            expect(failedRecovery.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
            failedRecovery.abort();

            const retryRecovery = await Promise.race([
                persistence.waitForTransaction('readwrite', 4),
                recovery.then(() => {
                    throw new Error('Migration recovery was swallowed after its first IDB failure');
                }),
            ]);
            expect(retryRecovery.writes.some((write) => write.kind === 'put' && write.key === 'root')).toBe(true);
            retryRecovery.complete();
            await recovery;

            const bundle = await readBundle(persistence, 1);
            if (!bundle) {
                throw new Error('Expected the retried migration full bundle');
            }
            automergeRepository.reset();
            await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
            expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
                migrationRetry: true,
            });
        } finally {
            if (!oldIncremental.isSettled()) {
                oldIncremental.abort();
            }
            await oldPersist.catch(() => undefined);
            await recovery?.catch(() => undefined);
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }
    });

    it('resets an incompatible HMR queue holder without reusing stale lifecycle state', async () => {
        const capturedStates: unknown[] = [];

        try {
            vi.resetModules();
            vi.doMock('#/utils/HMR/createHmrPersistentState', () => ({
                createHmrPersistentState: <State>(key: string, factory: () => State): State => {
                    const state = createHmrPersistentState(key, factory);
                    capturedStates.push(state);
                    return state;
                },
            }));
            vi.doMock('../../repositories/automergeRepository', () => ({ automergeRepository }));
            await import('../persistCrdtProject');

            const state = capturedStates[0];
            if (!isVersionedQueueState(state)) {
                throw new Error('Expected the queue HMR state holder');
            }
            state.pendingChunks = { stale: true };
            state.pendingFullSnapshot = { stale: true };
            const previousGeneration = state.persistenceGeneration;
            state.version = 0;

            vi.resetModules();
            await import('../persistCrdtProject');

            const recoverySave = await persistence.waitForTransaction('readwrite', 1);
            recoverySave.complete();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));

            expect(state.version).toBe(5);
            expect(state.persistenceGeneration).toBe(previousGeneration + 1);
            expect(state.pendingChunks).toEqual([]);
            expect(state.pendingFullSnapshot).toBeNull();
            expect(state.persistedBaseDocIds).toEqual(new Set());
        } finally {
            vi.doUnmock('../../repositories/automergeRepository');
            vi.doUnmock('#/utils/HMR/createHmrPersistentState');
            vi.resetModules();
        }
    });
});

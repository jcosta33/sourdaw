import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { loadAllFromIdb } from '../../repositories/crdtPersistence/loadAllFromIdb';
import { compactProject } from '../compactProject';
import { runCrdtPersistenceOperation } from '../crdtPersistenceQueue';
import { crdtProjectCompactionState } from '../crdtProjectCompactionState';
import { createCrdtProject } from '../createCrdtProject';
import { persistCrdtProject } from '../persistCrdtProject';

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
        expect([...persistence.records.keys()].sort()).toEqual(['child-1', 'root']);

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
        expect([...persistence.records.keys()]).toEqual(['root']);
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
        automergeRepository.createProject('new-project');
        const newProjectCompaction = compactProject();

        oldIncremental.abort();
        await expect(oldPersist).rejects.toThrow('IDB transaction aborted');

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
        expect([...persistence.records.keys()]).toEqual(['root']);

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
});

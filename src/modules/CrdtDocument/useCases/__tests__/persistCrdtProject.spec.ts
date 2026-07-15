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

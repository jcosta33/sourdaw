import { clone as cloneDoc } from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { loadAllFromIdb } from '../../repositories/crdtPersistence/loadAllFromIdb';
import { PERSISTENCE_AUTHORITY_KEY } from '../../repositories/crdtPersistence/persistenceAuthorityModel';
import { TransactionalPersistence } from '../../testing/transactionalPersistence';
import { compactProject } from '../compactProject';
import { crdtProjectCompactionState } from '../crdtProjectCompactionState';
import { persistCrdtProject } from '../persistCrdtProject';
import { runCrdtPersistenceOperation } from '../runCrdtPersistenceOperation';

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

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('compactProject', () => {
    let persistence: TransactionalPersistence;

    beforeEach(() => {
        vi.clearAllMocks();
        persistence = new TransactionalPersistence();
        mocks.openDatabase.mockResolvedValue(persistence.database);
        automergeRepository.reset();
        void runCrdtPersistenceOperation('reset');
        crdtProjectCompactionState.incrementalSaveCount = 0;
    });

    it('keeps the committed count until full-save completion and rolls back an abort', async () => {
        automergeRepository.createProject('project');
        crdtProjectCompactionState.incrementalSaveCount = 3;

        const compaction = compactProject();
        const fullSave = await persistence.waitForTransaction('readwrite', 1);

        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(3);
        expect(persistence.records.size).toBe(0);

        fullSave.abort();
        await expect(compaction).rejects.toThrow('IDB transaction aborted');
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(3);
        expect(persistence.records.size).toBe(0);

        const retry = compactProject();
        const retrySave = await persistence.waitForTransaction('readwrite', 2);
        retrySave.complete();
        await retry;

        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
        expect(persistence.records.has('root')).toBe(true);
    });

    it('flushes a retained failed chunk before a direct compaction caller captures a snapshot', async () => {
        automergeRepository.createProject('project');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.retained = true;
        });

        const firstPersist = persistCrdtProject();
        const firstTransaction = await persistence.waitForTransaction('readwrite', 1);
        const firstChunk = firstTransaction.writes.find((write) => write.kind === 'add');
        expect(firstChunk).toBeDefined();
        const compaction = compactProject();
        firstTransaction.abort();
        await expect(firstPersist).rejects.toThrow('IDB transaction aborted');

        const retryIncremental = await persistence.waitForTransaction('readwrite', 2);
        const retryChunk = retryIncremental.writes.find((write) => write.kind === 'add');
        expect(retryChunk?.value).toEqual(firstChunk?.value);
        retryIncremental.complete();

        const fullSave = await persistence.waitForTransaction('readwrite', 3);
        fullSave.complete();
        await compaction;

        expect(persistence.getTransactions('readwrite')).toHaveLength(3);
        expect(persistence.getTransactions('readwrite')[2]?.writes.some((write) => write.kind === 'add')).toBe(false);
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected a compacted bundle');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ retained: true });
    });

    it('serializes a post-snapshot edit behind full persistence and keeps one obsolete-free incremental', async () => {
        automergeRepository.createProject('project');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.beforeCompaction = true;
        });

        const initialPersist = persistCrdtProject();
        const initialIncremental = await persistence.waitForTransaction('readwrite', 1);
        initialIncremental.complete();
        await initialPersist;
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(1);

        const compaction = compactProject();
        const fullSave = await persistence.waitForTransaction('readwrite', 2);
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.afterSnapshot = true;
        });
        const postSnapshotPersist = persistCrdtProject();
        await flushMicrotasks();

        expect(persistence.getTransactions('readwrite')).toHaveLength(2);
        expect(persistence.records.has('root:incremental:obsolete')).toBe(false);

        fullSave.complete();
        await compaction;
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
        expect([...persistence.records.keys()].filter((key) => key !== PERSISTENCE_AUTHORITY_KEY)).toHaveLength(1);

        const postSnapshotIncremental = await persistence.waitForTransaction('readwrite', 3);
        postSnapshotIncremental.complete();
        await postSnapshotPersist;

        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(1);
        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected a persisted bundle');
        }
        const incrementalEntries = [...bundle.entries()].filter(([key]) => key.startsWith('root:incremental:'));
        expect(incrementalEntries).toHaveLength(1);

        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            beforeCompaction: true,
            afterSnapshot: true,
        });
    });

    it('keeps a failed branch-switch snapshot ahead of later autosave edits', async () => {
        automergeRepository.createProject('project');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.outgoingBranch = true;
        });

        const baseCompaction = compactProject();
        const baseSave = await persistence.waitForTransaction('readwrite', 1);
        baseSave.complete();
        await baseCompaction;

        automergeRepository.createChildDoc('branch_target');
        automergeRepository.changeDoc('branch_target', (doc: Record<string, unknown>) => {
            doc.targetBranch = true;
        });
        const targetDoc = automergeRepository.getDoc('branch_target');
        if (!targetDoc) {
            throw new Error('Expected the target branch document');
        }
        automergeRepository.replaceDoc('root', cloneDoc(targetDoc));

        const failedBranchSwitchCompaction = compactProject();
        const failedFullSave = await persistence.waitForTransaction('readwrite', 2);
        const failedRoot = failedFullSave.writes.find((write) => write.kind === 'put' && write.key === 'root');
        expect(failedRoot).toBeDefined();
        failedFullSave.abort();
        await expect(failedBranchSwitchCompaction).rejects.toThrow('IDB transaction aborted');

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.afterFailedSnapshot = true;
        });
        const autosave = persistCrdtProject();
        const retriedFullSave = await persistence.waitForTransaction('readwrite', 3);
        expect(retriedFullSave.writes.some((write) => write.kind === 'add')).toBe(false);
        const retriedRoot = retriedFullSave.writes.find((write) => write.kind === 'put' && write.key === 'root');
        expect(retriedRoot?.value).toEqual(failedRoot?.value);
        retriedFullSave.complete();

        const postSnapshotIncremental = await persistence.waitForTransaction('readwrite', 4);
        postSnapshotIncremental.complete();
        await autosave;

        const bundle = await readBundle(persistence, 1);
        if (!bundle) {
            throw new Error('Expected the switched project bundle');
        }
        expect([...bundle.keys()].filter((key) => key.startsWith('root:incremental:'))).toHaveLength(1);

        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle, shouldCommit: () => true })).resolves.toBe(true);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            targetBranch: true,
            afterFailedSnapshot: true,
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('outgoingBranch');
    });
});

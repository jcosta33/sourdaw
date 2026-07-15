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

async function importContext(): Promise<PersistenceContext> {
    vi.resetModules();
    const [queue, repository, snapshot] = await Promise.all([
        import('../crdtPersistenceQueue'),
        import('../../repositories/automergeRepository'),
        import('../../repositories/crdtPersistence/loadPersistenceSnapshotFromIdb'),
    ]);
    return { queue, repository, snapshot };
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
        const emptyAuthority = { epoch: '', revision: 0 };

        firstContext.repository.automergeRepository.createProject('project');
        firstContext.queue.setCrdtPersistenceAuthority(emptyAuthority);

        const basePersist = firstContext.queue.runCrdtPersistenceOperation('compact');
        const baseTransaction = await persistence.waitForTransaction('readwrite', 1);
        baseTransaction.complete();
        await basePersist;

        const baseSnapshot = await firstContext.snapshot.loadPersistenceSnapshotFromIdb();
        if (!baseSnapshot?.bundle) {
            throw new Error('Expected the shared base snapshot');
        }
        await secondContext.repository.automergeRepository.loadAll({
            bundle: baseSnapshot.bundle,
            shouldCommit: () => true,
        });
        secondContext.queue.setCrdtPersistenceAuthority(baseSnapshot.authority);

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
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ControlledWorker,
    respondToCompactShadow,
    respondToLoad,
    type CompactShadowRequest,
} from '../../repositories/__tests__/automergeWorkerTestHarness';
import { automergeRepository } from '../../repositories/automergeRepository';
import { TransactionalPersistence } from '../../testing/transactionalPersistence';
import { compactProject } from '../compactProject';
import { crdtProjectCompactionState } from '../crdtProjectCompactionState';
import { runCrdtPersistenceOperation } from '../runCrdtPersistenceOperation';

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

vi.stubGlobal('Worker', ControlledWorker);

type ServeWorkerOutput = {
    compactRequests: CompactShadowRequest[];
    lastCompactedRootBytes: () => Uint8Array | undefined;
};

function serveWorker(): ServeWorkerOutput {
    const compactRequests: CompactShadowRequest[] = [];
    let lastBundle: [string, Uint8Array][] = [];

    ControlledWorker.onPostMessage = (worker, request) => {
        if (request.type === 'loadBundle') {
            queueMicrotask(() => respondToLoad(worker, request));
            return;
        }
        if (request.type !== 'compactShadow') {
            return;
        }
        compactRequests.push(request);
        queueMicrotask(() => {
            const emitted = vi.spyOn(worker, 'emitMessage');
            respondToCompactShadow(worker, request);
            const response = emitted.mock.calls[0]?.[0];
            if (response?.type === 'compacted') {
                lastBundle = response.bundle;
            }
            emitted.mockRestore();
        });
    };

    return {
        compactRequests,
        lastCompactedRootBytes: () => new Map(lastBundle).get('root'),
    };
}

async function flushMicrotasks(): Promise<void> {
    for (let tick = 0; tick < 4; tick++) {
        await Promise.resolve();
    }
}

/**
 * CC-8 — compaction's full re-encode belongs in the CRDT worker.
 *
 * The sibling `compactProject.spec.ts` deliberately runs with an unavailable
 * Worker and therefore pins the synchronous fallback. These tests pin the
 * off-thread path and, critically, that routing through the worker did not
 * swallow a persistence failure.
 */
describe('compactProject off-thread full save', () => {
    let persistence: TransactionalPersistence;

    beforeEach(() => {
        vi.clearAllMocks();
        ControlledWorker.reset();
        persistence = new TransactionalPersistence();
        mocks.openDatabase.mockResolvedValue(persistence.database);
        automergeRepository.reset();
        void runCrdtPersistenceOperation('reset');
        crdtProjectCompactionState.incrementalSaveCount = 0;
    });

    it('persists the bundle the worker encoded rather than a main-thread save', async () => {
        const worker = serveWorker();
        automergeRepository.createProject('project');

        // The first compaction has no replica to lean on: it saves here and
        // seeds the worker so later compactions can run off-thread.
        const seeding = compactProject();
        (await persistence.waitForTransaction('readwrite', 1)).complete();
        await seeding;
        await flushMicrotasks();
        expect(worker.compactRequests).toHaveLength(0);

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.offThread = true;
        });
        const compaction = compactProject();
        const fullSave = await persistence.waitForTransaction('readwrite', 2);
        fullSave.complete();
        await compaction;

        expect(worker.compactRequests).toHaveLength(1);
        expect(worker.compactRequests[0]?.deltas.map(([id]) => id)).toEqual(['root']);
        // The durable record is the worker's encode. (`saveAllToIdb` copies the
        // buffer on the way out, so this is byte equality rather than identity;
        // `automergeRepository.offThreadSave.spec.ts` pins the identity hand-off.)
        const persistedRoot = fullSave.writes.find((write) => write.kind === 'put' && write.key === 'root');
        expect(persistedRoot?.value).toStrictEqual(worker.lastCompactedRootBytes());
    });

    it('still rejects when the persistence transaction aborts after the worker encoded', async () => {
        const worker = serveWorker();
        automergeRepository.createProject('project');

        const seeding = compactProject();
        (await persistence.waitForTransaction('readwrite', 1)).complete();
        await seeding;
        await flushMicrotasks();

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.doomed = true;
        });
        const compaction = compactProject();
        const fullSave = await persistence.waitForTransaction('readwrite', 2);
        fullSave.abort();

        // The worker hop must not turn a failed save into a silent success.
        await expect(compaction).rejects.toThrow('IDB transaction aborted');
        expect(worker.compactRequests).toHaveLength(1);
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
    });
});

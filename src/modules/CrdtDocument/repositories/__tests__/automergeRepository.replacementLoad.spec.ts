import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionalPersistence } from '../../testing/transactionalPersistence';
import { compactProject } from '../../useCases/compactProject';
import { loadCrdtProject } from '../../useCases/loadCrdtProject';
import { persistCrdtProject } from '../../useCases/persistCrdtProject';
import { runCrdtPersistenceOperation } from '../../useCases/runCrdtPersistenceOperation';
import { automergeRepository } from '../automergeRepository';
import { loadAllFromIdb } from '../crdtPersistence/loadAllFromIdb';

import {
    completePersistenceWritesUntilSettled,
    ControlledWorker,
    respondToLoad,
    respondToMerge,
    type LoadBundleRequest,
} from './automergeWorkerTestHarness';

const mocks = vi.hoisted(() => ({
    openDatabase: vi.fn(),
}));

vi.mock('#/utils/HMR/createHmrPersistentState', () => ({
    createHmrPersistentState: <State>(_key: string, factory: () => State): State => factory(),
}));

vi.mock('../crdtPersistence/helpers', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../crdtPersistence/helpers')>()),
    openDatabase: mocks.openDatabase,
}));

/**
 * Split out of automergeRepository.worker.spec.ts: there, per-test
 * `vi.resetModules()` forced every `await import` to re-evaluate the whole
 * CrdtDocument graph (automerge WASM init included) inside the test body,
 * so under parallel load the test blew the 5000 ms budget while its real
 * work is microseconds of deterministic microtasks. Here the graph loads
 * once at collection time; the worker/persistence harness stays
 * microtask-driven (no real timers anywhere).
 */
describe('AutomergeRepository replacement load authority', () => {
    beforeEach(() => {
        ControlledWorker.reset();
        vi.stubGlobal('Worker', ControlledWorker);
        mocks.openDatabase.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('aborts an old incremental before a delayed replacement load can adopt authority', async () => {
        const persistence = new TransactionalPersistence();
        mocks.openDatabase.mockImplementation(() => Promise.resolve(persistence.database));

        automergeRepository.reset();
        await runCrdtPersistenceOperation('reset');
        automergeRepository.createProject('project');
        const baseCompaction = compactProject();
        const baseTransaction = await persistence.waitForTransaction('readwrite', 1);
        baseTransaction.complete();
        await baseCompaction;

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.oldGenerationEdit = true;
        });
        const oldSave = persistCrdtProject();
        const oldTransaction = await persistence.waitForTransaction('readwrite', 2);
        expect(oldTransaction.writes.some(({ kind }) => kind === 'add')).toBe(true);

        let resolveDeferredLoad: ((value: { worker: ControlledWorker; request: LoadBundleRequest }) => void) | null =
            null;
        const deferredLoad = new Promise<{ worker: ControlledWorker; request: LoadBundleRequest }>((resolve) => {
            resolveDeferredLoad = resolve;
        });
        let hasDeferredLoad = false;
        ControlledWorker.onPostMessage = (worker, request) => {
            if (!hasDeferredLoad && request.type === 'loadBundle') {
                hasDeferredLoad = true;
                resolveDeferredLoad?.({ worker, request });
                return;
            }
            queueMicrotask(() => {
                if (request.type === 'loadBundle') {
                    respondToLoad(worker, request);
                } else {
                    respondToMerge(worker, request);
                }
            });
        };

        const replacementLoad = loadCrdtProject();
        await persistence.waitForTransaction('readonly', 1);
        const delayedWorkerRequest = await deferredLoad;
        oldTransaction.complete();
        respondToLoad(delayedWorkerRequest.worker, delayedWorkerRequest.request);

        await expect(oldSave).resolves.toBeUndefined();
        await expect(replacementLoad).resolves.toBe(true);

        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.afterReplacementLoad = true;
        });
        const postLoadSave = persistCrdtProject();
        await completePersistenceWritesUntilSettled({
            operation: postLoadSave,
            persistence,
            startOccurrence: 3,
        });

        const durableBundle = await loadAllFromIdb();
        if (!durableBundle) {
            throw new Error('Expected durable project bundle');
        }
        automergeRepository.reset();
        await expect(automergeRepository.loadAll({ bundle: durableBundle, shouldCommit: () => true })).resolves.toBe(
            true
        );

        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            afterReplacementLoad: true,
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('oldGenerationEdit');
        expect(oldTransaction.isAbortRequested()).toBe(true);
    });
});

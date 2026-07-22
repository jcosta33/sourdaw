import { change, load, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ControlledWorker,
    createRootBundle,
    deferFirstMergeRequest,
    respondToLoad,
    respondToMerge,
    type LoadBundleRequest,
} from './automergeWorkerTestHarness';

describe('AutomergeRepository worker lifecycle', () => {
    beforeEach(() => {
        ControlledWorker.reset();
        vi.resetModules();
        vi.stubGlobal('Worker', ControlledWorker);
    });

    afterEach(() => {
        vi.doUnmock('#/utils/HMR/createHmrPersistentState');
        vi.doUnmock('../crdtPersistence/helpers');
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('retries a worker merge from fresh documents after an in-flight local mutation', async () => {
        const deferredMerge = deferFirstMergeRequest();

        const { automergeRepository } = await import('../automergeRepository');
        automergeRepository.createProject('project');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.base = true;
        });
        const baseBytes = automergeRepository.saveDoc('root');
        if (!baseBytes) {
            throw new Error('Expected base root bytes');
        }
        let remote = load<Record<string, unknown>>(baseBytes);
        remote = change(remote, (doc) => {
            doc.remoteDuringMerge = true;
        });

        const mergeOperation = automergeRepository.mergeBundle(new Map([['root', save(remote)]]));
        const firstRequest = await deferredMerge.firstRequest;
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.localDuringMerge = true;
        });
        respondToMerge(firstRequest.worker, firstRequest.request);
        await mergeOperation;

        expect(deferredMerge.getRequestCount()).toBe(2);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            localDuringMerge: true,
            remoteDuringMerge: true,
        });
    });

    it('rejects an in-flight merge instead of resurrecting a locally removed document', async () => {
        const deferredMerge = deferFirstMergeRequest();
        const { automergeRepository } = await import('../automergeRepository');
        automergeRepository.createProject('project');
        automergeRepository.createChildDoc('branch_local');
        automergeRepository.changeDoc('branch_local', (doc: Record<string, unknown>) => {
            doc.base = true;
        });
        const childBytes = automergeRepository.saveDoc('branch_local');
        if (!childBytes) {
            throw new Error('Expected child document bytes');
        }
        let remote = load<Record<string, unknown>>(childBytes);
        remote = change(remote, (doc) => {
            doc.remoteDuringMerge = true;
        });

        const mergeOperation = automergeRepository.mergeBundle(new Map([['branch_local', save(remote)]]));
        const firstRequest = await deferredMerge.firstRequest;
        automergeRepository.removeDoc('branch_local');
        respondToMerge(firstRequest.worker, firstRequest.request);

        await expect(mergeOperation).rejects.toThrow(/document identity changed/i);
        expect(automergeRepository.hasDoc('branch_local')).toBe(false);
    });

    it('rejects an old in-flight merge after the repository is replaced', async () => {
        const deferredMerge = deferFirstMergeRequest();
        const { automergeRepository } = await import('../automergeRepository');
        automergeRepository.createProject('old project');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.oldProject = true;
        });
        const oldRootBytes = automergeRepository.saveDoc('root');
        if (!oldRootBytes) {
            throw new Error('Expected old root bytes');
        }
        let remote = load<Record<string, unknown>>(oldRootBytes);
        remote = change(remote, (doc) => {
            doc.remoteOldProject = true;
        });

        const mergeOperation = automergeRepository.mergeBundle(new Map([['root', save(remote)]]));
        const firstRequest = await deferredMerge.firstRequest;
        automergeRepository.reset();
        automergeRepository.createProject('replacement');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.replacementProject = true;
        });
        respondToMerge(firstRequest.worker, firstRequest.request);

        await expect(mergeOperation).rejects.toThrow(/document identity changed/i);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ replacementProject: true });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('remoteOldProject');
    });

    it('rejects a delayed load after a same-document local mutation', async () => {
        let resolveLoad!: (value: { worker: ControlledWorker; request: LoadBundleRequest }) => void;
        const deferredLoad = new Promise<{ worker: ControlledWorker; request: LoadBundleRequest }>((resolve) => {
            resolveLoad = resolve;
        });
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type === 'loadBundle') {
                resolveLoad({ worker, request });
            }
        };

        const { automergeRepository } = await import('../automergeRepository');
        automergeRepository.createProject('current');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.current = true;
        });

        const loadOperation = automergeRepository.loadAll({ bundle: createRootBundle() });
        const delayedRequest = await deferredLoad;
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.localDuringLoad = true;
        });
        respondToLoad(delayedRequest.worker, delayedRequest.request);

        await expect(loadOperation).rejects.toThrow(/changed during load/i);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            current: true,
            localDuringLoad: true,
        });
    });

    it.each(['error', 'messageerror'] as const)('replaces a worker after a fatal $0 event', async (fatalEvent) => {
        const { automergeRepository } = await import('../automergeRepository');
        const bundle = createRootBundle();

        const firstValidation = automergeRepository.validateAll({ bundle });
        const firstWorker = ControlledWorker.instances[0];
        if (!firstWorker) {
            throw new Error('Expected the first worker');
        }
        ControlledWorker.onPostMessage = (worker, request) => {
            if (worker !== firstWorker && request.type === 'loadBundle') {
                queueMicrotask(() => respondToLoad(worker, request));
            }
        };
        firstWorker.emitFatal(fatalEvent);

        await expect(firstValidation).resolves.toBe(true);
        expect(firstWorker.terminated).toBe(true);

        await expect(automergeRepository.validateAll({ bundle })).resolves.toBe(true);
        expect(ControlledWorker.instances).toHaveLength(2);
    });

    it('settles every concurrent request when their shared worker fails', async () => {
        const { automergeRepository } = await import('../automergeRepository');
        const bundle = createRootBundle();

        const firstValidation = automergeRepository.validateAll({ bundle });
        const secondValidation = automergeRepository.validateAll({ bundle });
        const worker = ControlledWorker.instances[0];
        if (!worker) {
            throw new Error('Expected a shared worker');
        }
        expect(worker.posted).toHaveLength(2);
        worker.emitFatal('error');

        await expect(Promise.all([firstValidation, secondValidation])).resolves.toEqual([true, true]);
        expect(worker.terminated).toBe(true);
    });
});

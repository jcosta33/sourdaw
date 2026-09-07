import { change, init, load, save } from '@automerge/automerge';
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

    it('changes the public root identity only when worker-backed merge installs a missing root', async () => {
        ControlledWorker.onPostMessage = (worker, request) => {
            queueMicrotask(() => {
                if (request.type === 'loadBundle') {
                    respondToLoad(worker, request);
                } else if (request.type === 'mergeBundle') {
                    respondToMerge(worker, request);
                }
            });
        };
        const { automergeRepository } = await import('../automergeRepository');
        const { captureProjectRootIdentity } = await import('../../useCases/captureProjectRootIdentity');
        automergeRepository.createProject('project');
        const rootBytes = automergeRepository.saveDoc('root');
        if (!rootBytes) {
            throw new Error('Expected root bytes');
        }
        let peerRoot = load<Record<string, unknown>>(rootBytes);
        peerRoot = change(peerRoot, (document) => {
            document.workerPeer = true;
        });
        let rootIdentity = captureProjectRootIdentity();

        await automergeRepository.mergeBundle(new Map([['root', save(peerRoot)]]));
        expect(captureProjectRootIdentity()).toBe(rootIdentity);

        automergeRepository.removeDoc('root');
        rootIdentity = captureProjectRootIdentity();
        await automergeRepository.mergeBundle(new Map([['root', save(peerRoot)]]));
        expect(captureProjectRootIdentity()).not.toBe(rootIdentity);
    });

    it('advances root identity when a worker result installs root before a later decode failure', async () => {
        let resolveMergeRequest!: (value: {
            worker: ControlledWorker;
            request: Parameters<typeof respondToMerge>[1];
        }) => void;
        const mergeRequest = new Promise<{
            worker: ControlledWorker;
            request: Parameters<typeof respondToMerge>[1];
        }>((resolve) => {
            resolveMergeRequest = resolve;
        });
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type === 'loadBundle') {
                queueMicrotask(() => respondToLoad(worker, request));
            } else if (request.type === 'mergeBundle') {
                resolveMergeRequest({ worker, request });
            }
        };
        const { automergeRepository } = await import('../automergeRepository');
        const { captureProjectRootIdentity } = await import('../../useCases/captureProjectRootIdentity');
        automergeRepository.createProject('project');
        const rootBytes = automergeRepository.saveDoc('root');
        if (!rootBytes) {
            throw new Error('Expected root bytes');
        }
        automergeRepository.removeDoc('root');
        const rootIdentity = captureProjectRootIdentity();
        const mergeOperation = automergeRepository.mergeBundle(
            new Map([
                ['root', rootBytes],
                [
                    'branch_bad',
                    save(
                        change(init<Record<string, unknown>>(), (document) => {
                            document.ok = true;
                        })
                    ),
                ],
            ])
        );
        const pending = await mergeRequest;
        pending.worker.emitMessage({
            id: pending.request.id,
            type: 'merged',
            compacted: [
                ['root', rootBytes],
                ['branch_bad', new Uint8Array([1, 2, 3])],
            ],
            mergedDocIds: [],
            newDocIds: ['root', 'branch_bad'],
        });

        await expect(mergeOperation).rejects.toThrow();
        expect(automergeRepository.hasDoc('root')).toBe(true);
        expect(captureProjectRootIdentity()).not.toBe(rootIdentity);
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

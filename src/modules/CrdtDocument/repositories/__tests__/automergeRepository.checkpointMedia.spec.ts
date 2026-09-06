import { load } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ControlledWorker,
    createRootBundle,
    respondToCompactShadow,
    respondToLoad,
    type InspectCheckpointRootMediaRequest,
} from './automergeWorkerTestHarness';

describe('AutomergeRepository checkpoint media inspection', () => {
    beforeEach(() => {
        ControlledWorker.reset();
        vi.resetModules();
        vi.stubGlobal('Worker', ControlledWorker);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('sends the exact checkpoint bytes, returns the worker census, and leaves live state unchanged', async () => {
        const observedRequests: InspectCheckpointRootMediaRequest[] = [];
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type !== 'inspectCheckpointRootMedia') {
                return;
            }
            observedRequests.push(request);
            queueMicrotask(() => {
                worker.emitMessage({
                    id: request.id,
                    type: 'checkpointRootMediaInspected',
                    audioBufferIds: ['alpha-buffer', 'zeta-buffer'],
                });
            });
        };

        const { automergeRepository } = await import('../automergeRepository');
        automergeRepository.createProject('live project');
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.liveMarker = 'live-a';
        });
        const liveDocument = automergeRepository.getDoc('root');
        const liveBytes = automergeRepository.saveDoc('root');
        const mutationEpoch = automergeRepository.getMutationEpoch();
        const identityEpoch = automergeRepository.getDocumentIdentityEpoch();
        const checkpointBytes = new Uint8Array([255, 12, 44, 0]);
        const checkpointCopy = checkpointBytes.slice();

        await expect(automergeRepository.inspectCheckpointRootMedia({ rootBytes: checkpointBytes })).resolves.toEqual({
            audioBufferIds: ['alpha-buffer', 'zeta-buffer'],
        });

        expect(observedRequests).toHaveLength(1);
        expect(observedRequests[0]?.rootBytes).toBe(checkpointBytes);
        const worker = ControlledWorker.instances[0];
        if (!worker) {
            throw new Error('Expected checkpoint inspection worker');
        }
        expect(worker.postMessageTransferArguments).toEqual([undefined]);
        expect(checkpointBytes).toEqual(checkpointCopy);
        expect(checkpointBytes.byteLength).toBe(checkpointCopy.byteLength);
        expect(automergeRepository.getDoc('root')).toBe(liveDocument);
        expect(automergeRepository.saveDoc('root')).toEqual(liveBytes);
        expect(automergeRepository.getDocIds()).toEqual(['root']);
        expect(automergeRepository.getMutationEpoch()).toBe(mutationEpoch);
        expect(automergeRepository.getDocumentIdentityEpoch()).toBe(identityEpoch);
    });

    it('preserves the warmed repository shadow so the next edited save stays off-thread', async () => {
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type === 'loadBundle') {
                queueMicrotask(() => respondToLoad(worker, request));
                return;
            }
            if (request.type === 'inspectCheckpointRootMedia') {
                queueMicrotask(() => {
                    worker.emitMessage({
                        id: request.id,
                        type: 'checkpointRootMediaInspected',
                        audioBufferIds: [],
                    });
                });
                return;
            }
            if (request.type === 'compactShadow') {
                queueMicrotask(() => respondToCompactShadow(worker, request));
            }
        };

        const liveBundle = createRootBundle();
        const checkpointBytes = createRootBundle().get('root');
        if (!checkpointBytes) {
            throw new Error('Expected captured checkpoint root bytes');
        }
        expect(checkpointBytes).not.toBe(liveBundle.get('root'));
        const { automergeRepository } = await import('../automergeRepository');
        await expect(automergeRepository.loadAll({ bundle: liveBundle })).resolves.toBe(true);
        const worker = ControlledWorker.instances[0];
        if (!worker) {
            throw new Error('Expected warmed CRDT worker');
        }
        expect(worker.posted.map((request) => request.type)).toEqual(['loadBundle']);

        await expect(automergeRepository.inspectCheckpointRootMedia({ rootBytes: checkpointBytes })).resolves.toEqual({
            audioBufferIds: [],
        });
        const requestCountAfterInspection = worker.posted.length;
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.editAfterInspection = 'survived';
        });

        const savedBundle = await automergeRepository.saveAllOffThread();

        const requestsAfterInspection = worker.posted.slice(requestCountAfterInspection);
        expect(requestsAfterInspection.map((request) => request.type)).toEqual(['compactShadow']);
        const compactRequest = requestsAfterInspection[0];
        if (compactRequest?.type !== 'compactShadow') {
            throw new Error('Expected one compactShadow request after inspection');
        }
        const rootDelta = compactRequest.deltas.find(([id]) => id === 'root');
        expect(rootDelta?.[1].byteLength).toBeGreaterThan(0);
        expect(new Map(compactRequest.expectedHeads).get('root')).toEqual(automergeRepository.getHeads('root'));
        const savedRoot = savedBundle.get('root');
        if (!savedRoot) {
            throw new Error('Expected saved root bytes');
        }
        expect(load<Record<string, unknown>>(savedRoot)).toMatchObject({
            seed: true,
            editAfterInspection: 'survived',
        });
    });

    it('rejects an unexpected worker response without decoding checkpoint bytes on the main thread', async () => {
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type === 'inspectCheckpointRootMedia') {
                queueMicrotask(() => {
                    worker.emitMessage({ id: request.id, type: 'loaded', compacted: [], rootId: 'root' });
                });
            }
        };
        const { automergeRepository } = await import('../automergeRepository');

        await expect(
            automergeRepository.inspectCheckpointRootMedia({ rootBytes: new Uint8Array([255, 0, 7]) })
        ).rejects.toThrow(/unexpected.*inspectCheckpointRootMedia.*loaded/i);
    });

    it('rejects a fatal worker failure and replaces the failed worker for a later inspection', async () => {
        const failedWorkers: ControlledWorker[] = [];
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type !== 'inspectCheckpointRootMedia') {
                return;
            }
            if (failedWorkers.length === 0) {
                failedWorkers.push(worker);
                queueMicrotask(() => worker.emitFatal('error'));
                return;
            }
            queueMicrotask(() => {
                worker.emitMessage({
                    id: request.id,
                    type: 'checkpointRootMediaInspected',
                    audioBufferIds: ['replacement-worker-buffer'],
                });
            });
        };
        const { automergeRepository } = await import('../automergeRepository');
        const invalidBytes = new Uint8Array([255, 0, 9]);

        await expect(automergeRepository.inspectCheckpointRootMedia({ rootBytes: invalidBytes })).rejects.toThrow(
            /crdtWorker crashed: controlled worker failure/
        );
        expect(failedWorkers[0]?.terminated).toBe(true);
        await expect(automergeRepository.inspectCheckpointRootMedia({ rootBytes: invalidBytes })).resolves.toEqual({
            audioBufferIds: ['replacement-worker-buffer'],
        });
        expect(ControlledWorker.instances).toHaveLength(2);
    });

    it('rejects worker startup failure', async () => {
        class StartupFailureWorker {
            constructor(_scriptUrl: string | URL, _options?: WorkerOptions) {
                throw new Error('controlled startup failure');
            }
        }
        vi.stubGlobal('Worker', StartupFailureWorker);
        const { automergeRepository } = await import('../automergeRepository');

        await expect(
            automergeRepository.inspectCheckpointRootMedia({ rootBytes: new Uint8Array([1]) })
        ).rejects.toThrow('controlled startup failure');
    });

    it('rejects a synchronous postMessage failure and terminates that worker', async () => {
        class PostMessageFailureWorker extends ControlledWorker {
            override postMessage(_value: unknown): void {
                throw new Error('controlled postMessage failure');
            }
        }
        vi.stubGlobal('Worker', PostMessageFailureWorker);
        const { automergeRepository } = await import('../automergeRepository');

        await expect(
            automergeRepository.inspectCheckpointRootMedia({ rootBytes: new Uint8Array([2]) })
        ).rejects.toThrow('crdtWorker postMessage failed: controlled postMessage failure');
        expect(ControlledWorker.instances[0]?.terminated).toBe(true);
    });
});

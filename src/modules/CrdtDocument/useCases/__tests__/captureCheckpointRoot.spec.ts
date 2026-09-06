import { clone, getHeads, load } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction, productionBriefAdmissionPort } from '#/modules/Command/useCases';

import { automergeRepository } from '../../repositories/automergeRepository';
import {
    ControlledWorker,
    createRootBundle,
    respondToCompactShadow,
    respondToLoad,
    type CompactShadowRequest,
} from '../../repositories/__tests__/automergeWorkerTestHarness';
import { captureCheckpointRoot } from '../captureCheckpointRoot';
import { captureProjectRevision } from '../captureProjectRevision';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';

type HeldCompactRequest = {
    request: CompactShadowRequest;
    worker: ControlledWorker;
};

function holdNextCompactRequest(): Promise<HeldCompactRequest> {
    let resolveCompact!: (value: HeldCompactRequest) => void;
    const compactRequest = new Promise<HeldCompactRequest>((resolve) => {
        resolveCompact = resolve;
    });

    ControlledWorker.onPostMessage = (worker, request) => {
        if (request.type === 'loadBundle') {
            queueMicrotask(() => respondToLoad(worker, request));
            return;
        }
        if (request.type === 'compactShadow') {
            resolveCompact({ request, worker });
        }
    };

    return compactRequest;
}

async function prepareLoadedProject(): Promise<{ compactRequest: Promise<HeldCompactRequest> }> {
    const compactRequest = holdNextCompactRequest();
    await expect(automergeRepository.loadAll({ bundle: createRootBundle() })).resolves.toBe(true);
    registerCrdtStorageRuntime();
    return { compactRequest };
}

function completeCompact({ request, worker }: HeldCompactRequest): Uint8Array {
    const emitted = vi.spyOn(worker, 'emitMessage');
    respondToCompactShadow(worker, request);
    const response = emitted.mock.calls[0]?.[0];
    emitted.mockRestore();
    if (response?.type !== 'compacted') {
        throw new Error('Expected the controlled worker to emit a compacted bundle');
    }
    const rootBytes = response.bundle.find(([id]) => id === 'root')?.[1];
    if (!rootBytes) {
        throw new Error('Expected the controlled worker to emit root bytes');
    }
    return rootBytes;
}

describe('captureCheckpointRoot', () => {
    beforeEach(() => {
        ControlledWorker.reset();
        vi.stubGlobal('Worker', ControlledWorker);
        configureAutomergeStoragePort(null);
        automergeRepository.reset();
        clearHandlerRegistry();
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        automergeRepository.reset();
        clearHandlerRegistry();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('returns the exact worker bytes for the expected root heads and state', async () => {
        const { compactRequest } = await prepareLoadedProject();
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.checkpoint = 'stable';
        });
        automergeRepository.createChildDoc('branch_checkpoint');
        automergeRepository.changeDoc('branch_checkpoint', (doc: Record<string, unknown>) => {
            doc.checkpoint = 'child';
        });

        const capture = captureCheckpointRoot();
        const exchange = await compactRequest;
        const emittedRootBytes = completeCompact(exchange);
        const checkpoint = await capture;

        const expectedRootHeads = exchange.request.expectedHeads.find(([id]) => id === 'root')?.[1];
        const expectedDocuments = exchange.request.expectedHeads
            .map(([docId, heads]) => ({ docId, heads: heads.toSorted() }))
            .toSorted(({ docId: left }, { docId: right }) => left.localeCompare(right));
        expect(checkpoint.rootBytes).toBe(emittedRootBytes);
        expect(getHeads(load<Record<string, unknown>>(checkpoint.rootBytes)).toSorted()).toEqual(
            expectedRootHeads?.toSorted()
        );
        expect(load<Record<string, unknown>>(checkpoint.rootBytes)).toMatchObject({
            seed: true,
            checkpoint: 'stable',
        });
        expect(checkpoint.projectRevision).toBe(captureProjectRevision());
        expect(JSON.parse(checkpoint.projectRevision)).toEqual({
            documentIdentityEpoch: automergeRepository.getDocumentIdentityEpoch(),
            mutationEpoch: automergeRepository.getMutationEpoch(),
            documents: expectedDocuments,
        });
    });

    it('settles a pending adapter write before capturing the worker root', async () => {
        const { compactRequest } = await prepareLoadedProject();
        const storage = createAutomergeStorage<{ value: number }>('root', 'pendingBeforeCapture');
        storage.hydrate?.();
        storage.set({ value: 1 });

        const capture = captureCheckpointRoot();
        const exchange = await compactRequest;
        completeCompact(exchange);
        const checkpoint = await capture;

        expect(load<Record<string, unknown>>(checkpoint.rootBytes)).toMatchObject({
            pendingBeforeCapture: { value: 1 },
        });
    });

    it('settles an unscoped adapter write at the final fence and rejects before its animation frame', async () => {
        const { compactRequest } = await prepareLoadedProject();
        const storage = createAutomergeStorage<{ value: number }>('root', 'duringCapture');
        storage.hydrate?.();
        const queuedFrames: FrameRequestCallback[] = [];
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            queuedFrames.push(callback);
            return queuedFrames.length;
        });

        const capture = captureCheckpointRoot();
        const exchange = await compactRequest;
        storage.set({ value: 2 });
        expect(queuedFrames).toHaveLength(1);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('duringCapture');

        completeCompact(exchange);

        await expect(capture).rejects.toThrow('Project changed during checkpoint capture');
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            duringCapture: { value: 2 },
        });
        expect(queuedFrames).toHaveLength(1);
    });

    it('rejects a registered executeAppAction write committed while serialization is waiting', async () => {
        const { compactRequest } = await prepareLoadedProject();
        const storage = createAutomergeStorage<{ value: number }>('root', 'actionDuringCapture');
        storage.hydrate?.();
        registerHandlerMap({
            setSnapValue: {
                describe: () => ({ label: 'Set checkpoint test snap value' }),
                execute: (action) => storage.set({ value: action.payload.value }),
                undoable: false,
            },
        });

        const capture = captureCheckpointRoot();
        const exchange = await compactRequest;
        await executeAppAction(
            { type: 'setSnapValue', payload: { value: 0.5 } },
            { skipMacroRecording: true, skipUndo: true }
        );
        completeCompact(exchange);

        await expect(capture).rejects.toThrow('Project changed during checkpoint capture');
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            actionDuringCapture: { value: 0.5 },
        });
    });

    it('rejects project ABA even when the root returns to the exact captured heads', async () => {
        const { compactRequest } = await prepareLoadedProject();
        const originalRoot = clone(automergeRepository.getDoc<Record<string, unknown>>('root')!);

        const capture = captureCheckpointRoot();
        const exchange = await compactRequest;
        const expectedRootHeads = exchange.request.expectedHeads.find(([id]) => id === 'root')?.[1];
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.temporary = 'project B';
        });
        automergeRepository.replaceDoc('root', clone(originalRoot));
        expect(automergeRepository.getHeads('root')?.toSorted()).toEqual(expectedRootHeads?.toSorted());
        completeCompact(exchange);

        await expect(capture).rejects.toThrow('Project changed during checkpoint capture');
    });

    it.each(['stale worker replica', 'worker failure'] as const)(
        'rejects when %s falls back after the repository advances',
        async (failureMode) => {
            const { compactRequest } = await prepareLoadedProject();

            const capture = captureCheckpointRoot();
            const { request, worker } = await compactRequest;
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.laterState = failureMode;
            });
            if (failureMode === 'stale worker replica') {
                worker.emitMessage({ id: request.id, type: 'compactStale', reason: 'forced stale checkpoint' });
            } else {
                worker.emitFatal('error');
            }

            await expect(capture).rejects.toThrow('Project changed during checkpoint capture');
        }
    );

    it('reports a missing root instead of misclassifying it as concurrent change', async () => {
        ControlledWorker.onPostMessage = (worker, request) => {
            if (request.type === 'loadBundle') {
                queueMicrotask(() => respondToLoad(worker, request));
            }
        };

        await expect(captureCheckpointRoot()).rejects.toThrow('Checkpoint root document is missing');
    });
});

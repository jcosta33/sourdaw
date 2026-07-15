import { change, init, load, merge, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type BundleEntry = [string, Uint8Array];

type LoadBundleRequest = {
    id: number;
    type: 'loadBundle';
    bundle: BundleEntry[];
};

type MergeBundleRequest = {
    id: number;
    type: 'mergeBundle';
    current: BundleEntry[];
    incoming: BundleEntry[];
};

type WorkerRequest = LoadBundleRequest | MergeBundleRequest;

type WorkerResponse =
    | { id: number; type: 'loaded'; compacted: BundleEntry[]; rootId: string }
    | { id: number; type: 'merged'; compacted: BundleEntry[]; mergedDocIds: string[]; newDocIds: string[] };

type FatalWorkerEvent = 'error' | 'messageerror';

function isBundleEntries(value: unknown): value is BundleEntry[] {
    return (
        Array.isArray(value) &&
        value.every(
            (entry) =>
                Array.isArray(entry) &&
                entry.length === 2 &&
                typeof entry[0] === 'string' &&
                entry[1] instanceof Uint8Array
        )
    );
}

function parseWorkerRequest(value: unknown): WorkerRequest {
    if (typeof value !== 'object' || value === null || !('id' in value) || !('type' in value)) {
        throw new TypeError('Expected a worker request');
    }
    if (typeof value.id !== 'number') {
        throw new TypeError('Expected a numeric worker request id');
    }
    if (value.type === 'loadBundle' && 'bundle' in value && isBundleEntries(value.bundle)) {
        return { id: value.id, type: value.type, bundle: value.bundle };
    }
    if (
        value.type === 'mergeBundle' &&
        'current' in value &&
        'incoming' in value &&
        isBundleEntries(value.current) &&
        isBundleEntries(value.incoming)
    ) {
        return { id: value.id, type: value.type, current: value.current, incoming: value.incoming };
    }
    throw new TypeError('Expected a supported worker request');
}

class ControlledWorker {
    static instances: ControlledWorker[] = [];
    static onPostMessage: ((worker: ControlledWorker, request: WorkerRequest) => void) | null = null;

    readonly posted: WorkerRequest[] = [];
    terminated = false;

    private failed = false;
    private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

    constructor(_scriptUrl: string | URL, _options?: WorkerOptions) {
        ControlledWorker.instances.push(this);
    }

    static reset(): void {
        ControlledWorker.instances = [];
        ControlledWorker.onPostMessage = null;
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (!listener) {
            return;
        }
        const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (!listener) {
            return;
        }
        this.listeners.get(type)?.delete(listener);
    }

    postMessage(value: unknown): void {
        if (this.failed) {
            throw new Error('postMessage called on a failed worker');
        }
        const request = parseWorkerRequest(value);
        this.posted.push(request);
        ControlledWorker.onPostMessage?.(this, request);
    }

    terminate(): void {
        this.terminated = true;
    }

    emitMessage(response: WorkerResponse): void {
        this.dispatch('message', new MessageEvent('message', { data: response }));
    }

    emitFatal(type: FatalWorkerEvent): void {
        this.failed = true;
        const event =
            type === 'error'
                ? new ErrorEvent('error', { message: 'controlled worker failure' })
                : new MessageEvent('messageerror');
        this.dispatch(type, event);
    }

    private dispatch(type: string, event: Event): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            if (typeof listener === 'function') {
                listener(event);
            } else {
                listener.handleEvent(event);
            }
        }
    }
}

function respondToLoad(worker: ControlledWorker, request: LoadBundleRequest): void {
    worker.emitMessage({
        id: request.id,
        type: 'loaded',
        compacted: request.bundle,
        rootId: 'root',
    });
}

function respondToMerge(worker: ControlledWorker, request: MergeBundleRequest): void {
    const compacted = new Map<string, Uint8Array>(request.current);
    const mergedDocIds: string[] = [];
    const newDocIds: string[] = [];

    for (const [id, incomingBytes] of request.incoming) {
        const currentBytes = compacted.get(id);
        if (currentBytes) {
            const current = load<Record<string, unknown>>(currentBytes);
            const incoming = load<Record<string, unknown>>(incomingBytes);
            compacted.set(id, save(merge(current, incoming)));
            mergedDocIds.push(id);
        } else {
            compacted.set(id, incomingBytes);
            newDocIds.push(id);
        }
    }

    worker.emitMessage({
        id: request.id,
        type: 'merged',
        compacted: [...compacted],
        mergedDocIds,
        newDocIds,
    });
}

function createRootBundle(): Map<string, Uint8Array> {
    let root = init<Record<string, unknown>>('aaaaaaaaaaaaaaaa');
    root = change(root, (doc) => {
        doc.seed = true;
    });
    return new Map([['root', save(root)]]);
}

function deferFirstMergeRequest(): {
    firstRequest: Promise<{ worker: ControlledWorker; request: MergeBundleRequest }>;
    getRequestCount: () => number;
} {
    let requestCount = 0;
    let resolveFirstRequest: ((value: { worker: ControlledWorker; request: MergeBundleRequest }) => void) | null = null;
    const firstRequest = new Promise<{ worker: ControlledWorker; request: MergeBundleRequest }>((resolve) => {
        resolveFirstRequest = resolve;
    });

    ControlledWorker.onPostMessage = (worker, request) => {
        if (request.type === 'loadBundle') {
            queueMicrotask(() => respondToLoad(worker, request));
            return;
        }
        requestCount++;
        if (requestCount === 1) {
            resolveFirstRequest?.({ worker, request });
            return;
        }
        queueMicrotask(() => respondToMerge(worker, request));
    };

    return { firstRequest, getRequestCount: () => requestCount };
}

describe('AutomergeRepository worker lifecycle', () => {
    beforeEach(() => {
        ControlledWorker.reset();
        vi.resetModules();
        vi.stubGlobal('Worker', ControlledWorker);
    });

    afterEach(() => {
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

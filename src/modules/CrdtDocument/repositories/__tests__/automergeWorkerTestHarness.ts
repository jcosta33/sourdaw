import { change, getHeads, init, load, loadIncremental, merge, save } from '@automerge/automerge';

import { compareIncrementalKeys } from '../crdtPersistence/compareIncrementalKeys';

import type { TransactionalPersistence } from '../../testing/transactionalPersistence';

export type BundleEntry = [string, Uint8Array];

export type HeadsEntry = [string, string[]];

export type LoadBundleRequest = {
    id: number;
    type: 'loadBundle';
    bundle: BundleEntry[];
    retainShadow?: boolean;
};

export type MergeBundleRequest = {
    id: number;
    type: 'mergeBundle';
    current: BundleEntry[];
    incoming: BundleEntry[];
};

export type CompactShadowRequest = {
    id: number;
    type: 'compactShadow';
    seeds: BundleEntry[];
    deltas: BundleEntry[];
    removedDocIds: string[];
    expectedHeads: HeadsEntry[];
};

export type InspectCheckpointRootMediaRequest = {
    id: number;
    type: 'inspectCheckpointRootMedia';
    rootBytes: Uint8Array;
};

export type WorkerRequest =
    LoadBundleRequest | MergeBundleRequest | CompactShadowRequest | InspectCheckpointRootMediaRequest;

export type WorkerResponse =
    | { id: number; type: 'loaded'; compacted: BundleEntry[]; rootId: string }
    | { id: number; type: 'merged'; compacted: BundleEntry[]; mergedDocIds: string[]; newDocIds: string[] }
    | { id: number; type: 'compacted'; bundle: BundleEntry[] }
    | { id: number; type: 'compactStale'; reason: string }
    | { id: number; type: 'checkpointRootMediaInspected'; audioBufferIds: string[] };

export type FatalWorkerEvent = 'error' | 'messageerror';

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

function isHeadsEntries(value: unknown): value is HeadsEntry[] {
    return (
        Array.isArray(value) &&
        value.every(
            (entry) =>
                Array.isArray(entry) &&
                entry.length === 2 &&
                typeof entry[0] === 'string' &&
                Array.isArray(entry[1]) &&
                entry[1].every((hash) => typeof hash === 'string')
        )
    );
}

/**
 * The worker's document replica, mirrored here so repository-level tests can
 * exercise the `compactShadow` round trip. The real replica logic lives in
 * `workers/crdtWorker.ts` and is pinned directly by `crdtWorker.spec.ts`.
 */
const shadowReplica = new Map<string, ReturnType<typeof load<Record<string, unknown>>>>();

function sameHeads(left: string[], right: string[]): boolean {
    return left.length === right.length && [...left].sort().every((hash, index) => hash === [...right].sort()[index]);
}

function parseWorkerRequest(value: unknown): WorkerRequest {
    if (typeof value !== 'object' || value === null || !('id' in value) || !('type' in value)) {
        throw new TypeError('Expected a worker request');
    }
    if (typeof value.id !== 'number') {
        throw new TypeError('Expected a numeric worker request id');
    }
    if (value.type === 'loadBundle' && 'bundle' in value && isBundleEntries(value.bundle)) {
        const retainShadow = 'retainShadow' in value && value.retainShadow === true;
        return { id: value.id, type: value.type, bundle: value.bundle, retainShadow };
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
    if (
        value.type === 'compactShadow' &&
        'seeds' in value &&
        'deltas' in value &&
        'removedDocIds' in value &&
        'expectedHeads' in value &&
        isBundleEntries(value.seeds) &&
        isBundleEntries(value.deltas) &&
        isHeadsEntries(value.expectedHeads) &&
        Array.isArray(value.removedDocIds)
    ) {
        return {
            id: value.id,
            type: value.type,
            seeds: value.seeds,
            deltas: value.deltas,
            removedDocIds: value.removedDocIds.map(String),
            expectedHeads: value.expectedHeads,
        };
    }
    if (value.type === 'inspectCheckpointRootMedia' && 'rootBytes' in value && value.rootBytes instanceof Uint8Array) {
        return { id: value.id, type: value.type, rootBytes: value.rootBytes };
    }
    throw new TypeError('Expected a supported worker request');
}

export class ControlledWorker {
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
        shadowReplica.clear();
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

export function respondToLoad(worker: ControlledWorker, request: LoadBundleRequest): void {
    const documents = new Map<string, ReturnType<typeof load<Record<string, unknown>>>>();
    const incrementals: BundleEntry[] = [];
    for (const [id, bytes] of request.bundle) {
        if (id.includes(':incremental:')) {
            incrementals.push([id, bytes]);
        } else {
            documents.set(id, load<Record<string, unknown>>(bytes));
        }
    }
    incrementals.sort(([left], [right]) => compareIncrementalKeys(left, right));
    for (const [key, bytes] of incrementals) {
        const documentId = key.slice(0, key.indexOf(':incremental:'));
        const document = documents.get(documentId);
        if (!document) {
            throw new Error(`Missing base document for ${key}`);
        }
        documents.set(documentId, loadIncremental(document, bytes));
    }

    if (request.retainShadow === true) {
        shadowReplica.clear();
        for (const [id, document] of documents) {
            shadowReplica.set(id, document);
        }
    }

    worker.emitMessage({
        id: request.id,
        type: 'loaded',
        compacted: [...documents].map(([id, document]) => [id, save(document)]),
        rootId: 'root',
    });
}

/** Mirror of the worker's `compactShadow` handler for repository-level tests. */
export function respondToCompactShadow(worker: ControlledWorker, request: CompactShadowRequest): void {
    for (const id of request.removedDocIds) {
        shadowReplica.delete(id);
    }
    for (const [id, bytes] of request.seeds) {
        shadowReplica.set(id, load<Record<string, unknown>>(bytes));
    }
    for (const [id, bytes] of request.deltas) {
        const document = shadowReplica.get(id);
        if (!document) {
            worker.emitMessage({ id: request.id, type: 'compactStale', reason: `no replica for ${id}` });
            return;
        }
        shadowReplica.set(id, loadIncremental(document, bytes));
    }

    const expected = new Map(request.expectedHeads);
    if (expected.size !== shadowReplica.size) {
        worker.emitMessage({ id: request.id, type: 'compactStale', reason: 'document set diverged' });
        return;
    }
    for (const [id, document] of shadowReplica) {
        const expectedHeads = expected.get(id);
        if (!expectedHeads || !sameHeads(getHeads(document), expectedHeads)) {
            worker.emitMessage({ id: request.id, type: 'compactStale', reason: `heads diverged for ${id}` });
            return;
        }
    }

    worker.emitMessage({
        id: request.id,
        type: 'compacted',
        bundle: [...shadowReplica].map(([id, document]) => [id, save(document)]),
    });
}

export function respondToMerge(worker: ControlledWorker, request: MergeBundleRequest): void {
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

    // The worker keeps the merged documents as its replica.
    shadowReplica.clear();
    for (const [id, bytes] of compacted) {
        shadowReplica.set(id, load<Record<string, unknown>>(bytes));
    }

    worker.emitMessage({
        id: request.id,
        type: 'merged',
        compacted: [...compacted],
        mergedDocIds,
        newDocIds,
    });
}

export function createRootBundle(): Map<string, Uint8Array> {
    let root = init<Record<string, unknown>>('aaaaaaaaaaaaaaaa');
    root = change(root, (doc) => {
        doc.seed = true;
    });
    return new Map([['root', save(root)]]);
}

export function deferFirstMergeRequest(): {
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
        if (request.type !== 'mergeBundle') {
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

export async function completePersistenceWritesUntilSettled({
    operation,
    persistence,
    startOccurrence,
}: {
    operation: Promise<void>;
    persistence: TransactionalPersistence;
    startOccurrence: number;
}): Promise<void> {
    const outcome = operation.then(
        () => ({ kind: 'resolved' as const }),
        (error: unknown) => ({ kind: 'rejected' as const, error })
    );
    let occurrence = startOccurrence;

    for (let attempt = 0; attempt < 4; attempt++) {
        const result = await Promise.race([
            outcome,
            persistence
                .waitForTransaction('readwrite', occurrence)
                .then((transaction) => ({ kind: 'transaction' as const, transaction })),
        ]);
        if (result.kind === 'resolved') {
            return;
        }
        if (result.kind === 'rejected') {
            throw result.error;
        }

        result.transaction.complete();
        occurrence++;
    }

    throw new Error('Persistence operation did not settle after four transactions');
}

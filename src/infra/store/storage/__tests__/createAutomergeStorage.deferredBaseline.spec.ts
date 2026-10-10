import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const createTestPort = (initialDoc: TestDoc = {}): { doc: TestDoc; port: TestPort } => {
    const doc = initialDoc;

    const port: TestPort = {
        getDoc: () => doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(doc);
        },
    };

    return { doc, port };
};

// Issue #4109 — a pending write that takes the `defer` terminal (no CRDT port,
// or no document before authority has been observed) drops the write but must
// keep its value visible. Retaining the value as the adapter's effective
// committed baseline is what makes that survive later recomputes.
describe('createAutomergeStorage deferred pending baseline', () => {
    let frameCallback: FrameRequestCallback | null = null;
    let requestAnimationFrameMock: ReturnType<typeof vi.fn<(callback: FrameRequestCallback) => number>>;
    let cancelAnimationFrameMock: ReturnType<typeof vi.fn<(handle: number) => void>>;

    beforeEach(() => {
        frameCallback = null;
        requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback): number => {
            frameCallback = callback;
            return 42;
        });
        cancelAnimationFrameMock = vi.fn();

        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('keeps a deferred seed visible when an unrelated scoped transaction aborts', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        storage.set({ count: 7 });
        frameCallback?.(100);

        expect(storage.get()).toEqual({ count: 7 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 99 });
        });
        transaction.abort();

        expect(storage.get()).toEqual({ count: 7 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);

        // The retained baseline keeps holding across further recomputes too.
        const secondTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 123 });
        });
        secondTransaction.abort();

        expect(storage.get()).toEqual({ count: 7 });
    });

    it('supersedes a retained deferred baseline with a genuine committed write', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        storage.set({ count: 7 });
        frameCallback?.(100);

        const { doc, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 42 });
        });
        transaction.commit();

        expect(storage.get()).toEqual({ count: 42 });
        expect(doc.state).toEqual({ count: 42 });
    });

    it('supersedes a retained deferred baseline with a hydrated document value', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        storage.set({ count: 7 });
        frameCallback?.(100);

        const { port } = createTestPort({ state: { count: 42 } });
        configureAutomergeStoragePort(port);

        expect(storage.hydrate?.()).toBe(true);
        expect(storage.get()).toEqual({ count: 42 });
    });

    it('never writes a retained deferred baseline through the port', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        storage.set({ count: 7 });
        frameCallback?.(100);

        const { doc, port } = createTestPort();
        configureAutomergeStoragePort(port);

        // Only the genuine write may persist state; the retained baseline is a
        // cache-level fallback and produces no document mutation of its own.
        storage.set({ count: 99 });
        flushAutomergeStorageWrites();

        expect(doc.state).toEqual({ count: 99 });
        expect(storage.get()).toEqual({ count: 99 });
    });

    it('lands a nested seed when a retained baseline is re-set unchanged against a wired document', () => {
        const storage = createAutomergeStorage<Record<string, number>>('root', 'state');

        // The baseline is retained with no port to receive it (#4109), so the
        // next genuine write's base is this cache value, not the document.
        storage.set({ a: 1, x: 2 });
        frameCallback?.(100);

        // The document holds the slot without the seed. Re-setting the same
        // value gives the flush no delta of its own; the seed must still land,
        // because the presence snapshot captured beside the base proves no
        // document ever held it. Letting the equal write stop at the slot
        // would strand `x` and the committed projection would then erase it
        // from the cache (#4962 review, reconcileCrdtSlot thread).
        const { doc, port } = createTestPort({ state: { a: 1 } });
        configureAutomergeStoragePort(port);
        storage.set({ a: 1, x: 2 });
        flushAutomergeStorageWrites();

        expect(doc.state).toEqual({ a: 1, x: 2 });
        expect(storage.get()).toEqual({ a: 1, x: 2 });
    });

    // Issue #5268 — a genuine write equal to the retained baseline used to diff
    // empty against it, so the document never received the value and the next
    // hydrate or reload fell back to the document's own value.
    it('persists a genuine write equal to the retained baseline over a document holding another value', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });

        storage.set({ count: 7 });
        frameCallback?.(100);

        const { doc, port } = createTestPort({ state: { count: 0 } });
        configureAutomergeStoragePort(port);
        storage.set({ count: 7 });
        flushAutomergeStorageWrites();

        expect(doc.state).toEqual({ count: 7 });
        storage.hydrate?.();
        expect(storage.get()).toEqual({ count: 7 });
    });

    it('persists a write buffered before wiring that equals the retained baseline', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });

        storage.set({ count: 7 });
        frameCallback?.(100);
        // Buffered with no port, so no document presence could be captured;
        // it reaches the document only after wiring.
        storage.set({ count: 7 });

        const { doc, port } = createTestPort();
        configureAutomergeStoragePort(port);
        flushAutomergeStorageWrites();

        expect(doc.state).toEqual({ count: 7 });
    });

    it('hands a custom slot mutation an unknown base for a write derived from the retained baseline', () => {
        const receivedBases: unknown[] = [];
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            mutateCrdt: ({ doc, key, baseValue, value }) => {
                receivedBases.push(baseValue);
                if (JSON.stringify(baseValue) === JSON.stringify(value)) {
                    return;
                }
                doc[key] = value;
            },
        });

        storage.set({ count: 7 });
        frameCallback?.(100);

        const { doc, port } = createTestPort();
        configureAutomergeStoragePort(port);
        storage.set({ count: 7 });
        flushAutomergeStorageWrites();

        expect(receivedBases).toEqual([null]);
        expect(doc.state).toEqual({ count: 7 });
    });

    it('falls back to the retained baseline when the post-wiring write aborts, and still persists a later re-set', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });

        storage.set({ count: 7 });
        frameCallback?.(100);

        const { doc, port } = createTestPort({ state: { count: 0 } });
        configureAutomergeStoragePort(port);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ count: 99 });
        });
        transaction.abort();

        expect(storage.get()).toEqual({ count: 7 });
        expect(doc.state).toEqual({ count: 0 });

        storage.set({ count: 7 });
        flushAutomergeStorageWrites();

        expect(doc.state).toEqual({ count: 7 });
    });

    it('diffs against hydrated authority once a hydrate supersedes the retained baseline', () => {
        const storage = createAutomergeStorage<Record<string, number>>('root', 'state');

        storage.set({ a: 1 });
        frameCallback?.(100);

        const { doc, port } = createTestPort({ state: { a: 1, b: 2 } });
        configureAutomergeStoragePort(port);
        expect(storage.hydrate?.()).toBe(true);
        expect(storage.get()).toEqual({ a: 1, b: 2 });

        // Only a base the hydrate supplied can carry this deletion of `b`.
        storage.set({ a: 1 });
        flushAutomergeStorageWrites();

        expect(doc.state).toEqual({ a: 1 });
    });

    it('diffs against the reset default once a projection reset supersedes the retained baseline', () => {
        const storage = createAutomergeStorage<Record<string, number>>('root', 'state', {
            hydrateMissing: () => ({ a: 0, b: 0 }),
        });

        storage.set({ a: 5 });
        frameCallback?.(100);

        const { doc, port } = createTestPort({ state: { a: 0, b: 0 } });
        configureAutomergeStoragePort(port);
        resetAutomergeStorageProjections('root');
        expect(storage.get()).toEqual({ a: 0, b: 0 });

        storage.set({ a: 0 });
        flushAutomergeStorageWrites();

        expect(doc.state).toEqual({ a: 0 });
    });

    it('diffs against the committed value once a genuine commit supersedes the retained baseline', () => {
        const storage = createAutomergeStorage<Record<string, number>>('root', 'state');

        storage.set({ a: 1 });
        frameCallback?.(100);

        const { doc, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ a: 1, b: 2 });
        });
        transaction.commit();
        expect(doc.state).toEqual({ a: 1, b: 2 });

        doc.state = { a: 1, b: 2, c: 3 };
        storage.set({ a: 1 });
        flushAutomergeStorageWrites();

        // The committed base saw `b` but never `c`: only `b` is this writer's
        // deletion, and `c` stands.
        expect(doc.state).toEqual({ a: 1, c: 3 });
    });
});

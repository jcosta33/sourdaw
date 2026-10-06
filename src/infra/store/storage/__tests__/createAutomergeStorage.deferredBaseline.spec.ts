import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
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
});

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
});

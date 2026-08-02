import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { openDatabase } from '../helpers';
import { loadDocFromIdb } from '../loadDocFromIdb';
import { loadIncrementalsFromIdb } from '../loadIncrementalsFromIdb';
import { replaceAllInIdb } from '../replaceAllInIdb';

vi.mock('../helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: vi.fn(),
}));

type MockRequest = {
    result: unknown;
    error: Error | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

function createMockRequest(result: unknown = undefined): MockRequest {
    return { result, error: null, onsuccess: null, onerror: null };
}

type MockCursor = {
    key: unknown;
    value: unknown;
    continue: Mock<() => void>;
};

type MockCursorRequest = {
    result: MockCursor | null;
    onsuccess: (() => void) | null;
};

type MockStore = {
    get: Mock<() => MockRequest>;
    put: Mock<(value: unknown, key: string) => MockRequest>;
    clear: Mock<() => void>;
    openCursor: Mock<() => MockCursorRequest>;
};

type MockTransaction = {
    objectStore: Mock<() => MockStore>;
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    error: Error | null;
};

function createMockStore(): MockStore {
    return {
        get: vi.fn<() => MockRequest>().mockReturnValue(createMockRequest()),
        put: vi.fn<(value: unknown, key: string) => MockRequest>().mockReturnValue(createMockRequest()),
        clear: vi.fn<() => void>(),
        openCursor: vi.fn<() => MockCursorRequest>().mockReturnValue({ result: null, onsuccess: null }),
    };
}

function createMockTransaction(store: MockStore): MockTransaction {
    return {
        objectStore: vi.fn<() => MockStore>().mockReturnValue(store),
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
    };
}

function createMockDb(transaction: MockTransaction): { transaction: Mock<() => MockTransaction> } {
    return { transaction: vi.fn<() => MockTransaction>().mockReturnValue(transaction) };
}

describe('crdtPersistence primitive repositories', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('loadDocFromIdb', () => {
        it('resolves null when IndexedDB is unavailable', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);

            await expect(loadDocFromIdb('root')).resolves.toBeNull();
        });

        it('resolves the stored bytes for the requested id', async () => {
            const store = createMockStore();
            const bytes = new Uint8Array([1, 2, 3]);
            const request = createMockRequest(bytes);
            store.get.mockReturnValue(request);
            const tx = createMockTransaction(store);
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);

            const promise = loadDocFromIdb('doc1');
            await Promise.resolve();
            await Promise.resolve();
            request.onsuccess?.();

            await expect(promise).resolves.toEqual(bytes);
            expect(store.get).toHaveBeenCalledWith('doc1');
        });

        it('resolves null when no record exists for the id', async () => {
            const store = createMockStore();
            const request = createMockRequest(undefined);
            store.get.mockReturnValue(request);
            const tx = createMockTransaction(store);
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);

            const promise = loadDocFromIdb('missing');
            await Promise.resolve();
            await Promise.resolve();
            request.onsuccess?.();

            await expect(promise).resolves.toBeNull();
        });

        it('rejects with the underlying request error on failure', async () => {
            const store = createMockStore();
            const failure = new Error('get failed');
            const request = createMockRequest(undefined);
            request.error = failure;
            store.get.mockReturnValue(request);
            const tx = createMockTransaction(store);
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);

            const promise = loadDocFromIdb('doc1');
            await Promise.resolve();
            await Promise.resolve();
            request.onerror?.();

            await expect(promise).rejects.toBe(failure);
        });
    });

    describe('loadIncrementalsFromIdb', () => {
        it('resolves an empty array when IndexedDB is unavailable', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);

            await expect(loadIncrementalsFromIdb('root')).resolves.toEqual([]);
        });

        it('collects only chunks whose key matches the "<id>:incremental:" prefix, in cursor order', async () => {
            const store = createMockStore();
            const entries: Array<{ key: string; value: Uint8Array }> = [
                { key: 'root:incremental:1-a', value: new Uint8Array([1]) },
                { key: 'other:incremental:1-a', value: new Uint8Array([9]) },
                { key: 'root:incremental:2-b', value: new Uint8Array([2]) },
            ];
            let index = 0;
            const cursorRequest: MockCursorRequest = { result: null, onsuccess: null };
            const advance = (): void => {
                const entry = entries[index];
                index += 1;
                cursorRequest.result = entry
                    ? {
                          key: entry.key,
                          value: entry.value,
                          continue: vi.fn(() => advance()),
                      }
                    : null;
                cursorRequest.onsuccess?.();
            };
            store.openCursor.mockReturnValue(cursorRequest);
            const tx = createMockTransaction(store);
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);

            const promise = loadIncrementalsFromIdb('root');
            await Promise.resolve();
            await Promise.resolve();
            advance();
            tx.oncomplete?.();

            await expect(promise).resolves.toEqual([new Uint8Array([1]), new Uint8Array([2])]);
        });

        it('resolves an empty array when the cursor has no entries', async () => {
            const store = createMockStore();
            const cursorRequest: MockCursorRequest = { result: null, onsuccess: null };
            store.openCursor.mockReturnValue(cursorRequest);
            const tx = createMockTransaction(store);
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);

            const promise = loadIncrementalsFromIdb('root');
            await Promise.resolve();
            await Promise.resolve();
            cursorRequest.onsuccess?.();
            tx.oncomplete?.();

            await expect(promise).resolves.toEqual([]);
        });

        it('rejects when the read transaction errors', async () => {
            const store = createMockStore();
            const cursorRequest: MockCursorRequest = { result: null, onsuccess: null };
            store.openCursor.mockReturnValue(cursorRequest);
            const tx = createMockTransaction(store);
            const failure = new Error('cursor failed');
            tx.error = failure;
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);

            const promise = loadIncrementalsFromIdb('root');
            await Promise.resolve();
            await Promise.resolve();
            tx.onerror?.();

            await expect(promise).rejects.toBe(failure);
        });
    });

    describe('replaceAllInIdb', () => {
        it('throws when IndexedDB is unavailable', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);

            await expect(replaceAllInIdb(new Map())).rejects.toThrow('CRDT persistence is unavailable');
        });

        it('clears the store and puts every entry from the bundle', async () => {
            const store = createMockStore();
            const tx = createMockTransaction(store);
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);
            const bundle = new Map([
                ['doc1', new Uint8Array([1])],
                ['doc2', new Uint8Array([2])],
            ]);

            const promise = replaceAllInIdb(bundle);
            await Promise.resolve();
            await Promise.resolve();
            tx.oncomplete?.();
            await promise;

            expect(store.clear).toHaveBeenCalledOnce();
            expect(store.put).toHaveBeenCalledWith(new Uint8Array([1]), 'doc1');
            expect(store.put).toHaveBeenCalledWith(new Uint8Array([2]), 'doc2');
        });

        it('rejects with the transaction error on failure', async () => {
            const store = createMockStore();
            const tx = createMockTransaction(store);
            const failure = new Error('replace failed');
            tx.error = failure;
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);

            const promise = replaceAllInIdb(new Map());
            await Promise.resolve();
            await Promise.resolve();
            tx.onerror?.();

            await expect(promise).rejects.toBe(failure);
        });

        it('rejects with a fallback message when the transaction aborts without an error', async () => {
            const store = createMockStore();
            const tx = createMockTransaction(store);
            vi.mocked(openDatabase).mockResolvedValue(createMockDb(tx) as unknown as IDBDatabase);

            const promise = replaceAllInIdb(new Map());
            await Promise.resolve();
            await Promise.resolve();
            tx.onabort?.();

            await expect(promise).rejects.toThrow('IDB transaction aborted');
        });
    });
});

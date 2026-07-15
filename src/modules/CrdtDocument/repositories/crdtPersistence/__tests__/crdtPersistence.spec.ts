import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearCrdtIdb } from '../clearCrdtIdb';
import { openDatabase } from '../helpers';
import { loadAllFromIdb } from '../loadAllFromIdb';
import { encodePersistenceAuthority } from '../persistenceAuthority';
import { saveAllToIdb } from '../saveAllToIdb';
import { saveIncrementalToIdb } from '../saveIncrementalToIdb';

vi.mock('../helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: vi.fn(),
}));

type MockStore = {
    clear: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
};

type MockTransaction = {
    objectStore: ReturnType<typeof vi.fn>;
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    error: Error | null;
    abort: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
};

function createMockStore(): MockStore {
    const get = vi.fn().mockImplementation(() => {
        const request: {
            result: undefined;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
            error: Error | null;
        } = { result: undefined, onsuccess: null, onerror: null, error: null };
        queueMicrotask(() => request.onsuccess?.());
        return request;
    });
    return {
        clear: vi.fn(),
        get,
        put: vi.fn(),
        add: vi.fn(),
    };
}

function createMockTransaction(store: MockStore, error: Error | null = new Error('tx error')): MockTransaction {
    const transaction: MockTransaction = {
        objectStore: vi.fn().mockReturnValue(store),
        oncomplete: null,
        onerror: null,
        onabort: null,
        error,
        abort: vi.fn(),
        complete: vi.fn(),
    };
    transaction.abort.mockImplementation(() => transaction.onabort?.());
    transaction.complete.mockImplementation(() => transaction.oncomplete?.());
    return transaction;
}

async function waitForRejection(promise: Promise<void>): Promise<unknown> {
    const timeoutError = new Error('transaction promise did not reject');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(() => reject(timeoutError), 100);
            }),
        ]);
    } catch (error: unknown) {
        if (error === timeoutError) {
            throw error;
        }
        return error;
    } finally {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
    }

    throw new Error('transaction promise resolved unexpectedly');
}

describe('crdtPersistence repository', () => {
    let mockTx: any;
    let mockStore: any;
    let mockDb: any;
    let mockRequest: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRequest = {
            onsuccess: null,
            onerror: null,
            result: null,
        };

        mockStore = {
            getAllKeys: vi.fn(),
            getAll: vi.fn(),
            clear: vi.fn().mockReturnValue(mockRequest),
            get: vi.fn().mockImplementation(() => {
                const request = {
                    result: undefined,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                    error: null as Error | null,
                };
                queueMicrotask(() => request.onsuccess?.());
                return request;
            }),
            put: vi.fn().mockReturnValue(mockRequest),
        };

        mockTx = {
            objectStore: vi.fn().mockReturnValue(mockStore),
            oncomplete: null,
            onerror: null,
            onabort: null,
            error: new Error('tx error'),
        };

        mockDb = {
            transaction: vi.fn().mockReturnValue(mockTx),
            close: vi.fn(),
        };
    });

    describe('loadAllFromIdb', () => {
        it('should return null when IndexedDB is unsupported', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);
            const result = await loadAllFromIdb();
            expect(result).toBeNull();
        });

        it('should propagate an operational database open failure', async () => {
            const failure = new Error('IndexedDB permission denied');
            vi.mocked(openDatabase).mockRejectedValue(failure);

            await expect(loadAllFromIdb()).rejects.toBe(failure);
        });

        it('should return null if no keys found', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const keysReq = { result: [] };
            const valsReq = { result: [] };
            mockStore.getAllKeys.mockReturnValue(keysReq);
            mockStore.getAll.mockReturnValue(valsReq);

            const promise = loadAllFromIdb();
            await Promise.resolve(); // wait for openDatabase to resolve
            mockTx.oncomplete(); // Trigger completion
            const result = await promise;

            expect(result).toBeNull();
        });

        it('should load and map documents to a bundle', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const keysReq = { result: ['doc1', 'doc2'] };
            const valsReq = { result: [new Uint8Array([1]), new Uint8Array([2])] };
            mockStore.getAllKeys.mockReturnValue(keysReq);
            mockStore.getAll.mockReturnValue(valsReq);

            const promise = loadAllFromIdb();
            await Promise.resolve();
            mockTx.oncomplete(); // Trigger completion
            const result = await promise;

            expect(result).toBeInstanceOf(Map);
            expect(result?.get('doc1')).toEqual(new Uint8Array([1]));
            expect(result?.get('doc2')).toEqual(new Uint8Array([2]));
        });

        it('should reject when the read transaction aborts', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            mockStore.getAllKeys.mockReturnValue({ result: ['root'] });
            mockStore.getAll.mockReturnValue({ result: [new Uint8Array([1])] });

            const promise = loadAllFromIdb();
            await Promise.resolve();
            mockTx.error = null;
            mockTx.onabort();

            await expect(promise).rejects.toThrow('IDB transaction aborted');
        });
    });

    describe('saveAllToIdb', () => {
        it('should return early if DB fails to open', async () => {
            vi.mocked(openDatabase).mockResolvedValue(null);
            await saveAllToIdb(new Map());
            expect(mockDb.transaction).not.toHaveBeenCalled();
        });

        it('should clear store and put all documents', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const bundle = new Map([
                ['doc1', new Uint8Array([1])],
                ['doc2', new Uint8Array([2])],
            ]);

            const promise = saveAllToIdb(bundle);
            await Promise.resolve();
            await Promise.resolve();
            mockTx.oncomplete(); // Trigger completion
            await promise;

            expect(mockStore.clear).toHaveBeenCalled();
            expect(mockStore.put).toHaveBeenCalledWith(new Uint8Array([1]), 'doc1');
            expect(mockStore.put).toHaveBeenCalledWith(new Uint8Array([2]), 'doc2');
        });

        it('rejects an abort-only transaction and allows a later retry to write once', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const firstStore = createMockStore();
            const retryStore = createMockStore();
            const transactionError = new Error('save-all aborted');
            const firstTx = createMockTransaction(firstStore, transactionError);
            const retryTx = createMockTransaction(retryStore);
            mockDb.transaction.mockReturnValueOnce(firstTx).mockReturnValueOnce(retryTx);
            const bundle = new Map([['doc1', new Uint8Array([1])]]);

            const firstAttempt = saveAllToIdb(bundle);
            await Promise.resolve();
            await Promise.resolve();
            firstTx.abort();

            await expect(waitForRejection(firstAttempt)).resolves.toBe(transactionError);

            const retry = saveAllToIdb(bundle);
            await Promise.resolve();
            await Promise.resolve();
            retryTx.complete();
            await retry;

            expect(firstStore.clear).toHaveBeenCalledOnce();
            expect(retryStore.clear).toHaveBeenCalledOnce();
            expect(firstStore.put.mock.calls.filter(([, key]) => key === 'doc1')).toHaveLength(1);
            expect(retryStore.put.mock.calls.filter(([, key]) => key === 'doc1')).toHaveLength(1);
            expect(retryStore.put).toHaveBeenCalledWith(new Uint8Array([1]), 'doc1');
        });

        it('detects a stale full bundle inside the IDB transaction instead of clearing newer records', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const bundle = new Map([['doc1', new Uint8Array([1])]]);
            const authority = { epoch: '', revision: 0 };
            let authorityReadCount = 0;
            mockStore.get.mockImplementation(() => {
                const request = {
                    result:
                        authorityReadCount++ === 0 ? undefined : encodePersistenceAuthority({ epoch: '', revision: 1 }),
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                    error: null as Error | null,
                };
                queueMicrotask(() => request.onsuccess?.());
                return request;
            });
            mockStore.getAllKeys.mockReturnValue({ result: ['doc1'] });
            mockStore.getAll.mockReturnValue({ result: [new Uint8Array([1])] });

            const firstSave = saveAllToIdb(bundle, { expectedAuthority: authority });
            await Promise.resolve();
            await Promise.resolve();
            mockTx.oncomplete();
            await expect(firstSave).resolves.toMatchObject({ status: 'committed' });

            const staleBundle = new Map([['doc1', new Uint8Array([2])]]);
            const staleSave = saveAllToIdb(staleBundle, { expectedAuthority: authority });
            await Promise.resolve();
            await Promise.resolve();
            expect(mockStore.get).toHaveBeenCalledTimes(2);
            expect(mockStore.get.mock.results[1]?.value.result).toEqual(
                encodePersistenceAuthority({ epoch: '', revision: 1 })
            );
            mockTx.oncomplete();

            await expect(staleSave).resolves.toMatchObject({ status: 'conflict' });
            expect(mockStore.clear).toHaveBeenCalledOnce();
        });
    });

    describe('saveIncrementalToIdb', () => {
        it('rejects an abort-only transaction with a fallback error and preserves later sequence/count semantics', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);
            const firstStore = createMockStore();
            const retryStore = createMockStore();
            const firstTx = createMockTransaction(firstStore, null);
            const retryTx = createMockTransaction(retryStore);
            mockDb.transaction.mockReturnValueOnce(firstTx).mockReturnValueOnce(retryTx);

            const firstAttempt = saveIncrementalToIdb('doc1', new Uint8Array([1]));
            await Promise.resolve();
            await Promise.resolve();
            firstTx.abort();

            const abortError = await waitForRejection(firstAttempt);
            expect(abortError).toMatchObject({ message: 'IDB transaction aborted' });

            const retry = saveIncrementalToIdb('doc1', new Uint8Array([2]));
            await Promise.resolve();
            await Promise.resolve();
            retryTx.complete();
            await retry;

            expect(firstStore.add).toHaveBeenCalledOnce();
            expect(retryStore.add).toHaveBeenCalledOnce();
            const firstKey = firstStore.add.mock.calls[0]?.[1];
            const retryKey = retryStore.add.mock.calls[0]?.[1];
            expect(firstKey).toMatch(/^doc1:incremental:\d+-[0-9a-z]+$/);
            expect(retryKey).toMatch(/^doc1:incremental:\d+-[0-9a-z]+$/);
            const firstSequence = Number.parseInt(String(firstKey).split('-').at(-1) ?? '', 36);
            const retrySequence = Number.parseInt(String(retryKey).split('-').at(-1) ?? '', 36);
            expect(retrySequence).toBe(firstSequence);
            expect(retryStore.add).toHaveBeenCalledWith(new Uint8Array([2]), retryKey);
        });
    });

    describe('clearCrdtIdb', () => {
        it('should clear the store', async () => {
            vi.mocked(openDatabase).mockResolvedValue(mockDb);

            const promise = clearCrdtIdb();
            await Promise.resolve();
            mockRequest.onsuccess(); // Trigger clear success
            await promise;

            expect(mockStore.clear).toHaveBeenCalled();
        });
    });
});

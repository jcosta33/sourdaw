import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAllFromIdb } from '../../repositories/crdtPersistence/loadAllFromIdb';
import { saveIncrementalToIdb } from '../../repositories/crdtPersistence/saveIncrementalToIdb';
import { compactProject } from '../compactProject';
import { crdtProjectCompactionState } from '../crdtProjectCompactionState';

type FakeRequest<Result> = {
    result: Result;
    onsuccess: (() => void) | null;
};

type FakeCursor = {
    key: string;
    delete: () => void;
    continue: () => void;
};

type FakeCursorRequest = FakeRequest<FakeCursor | null>;
type FakeOperation = () => void;

function createFakeRequest<Result>(result: Result): FakeRequest<Result> {
    return {
        result,
        onsuccess: null,
    };
}

class SharedPersistenceTransaction {
    readonly mode: IDBTransactionMode;
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: DOMException | null = null;

    private readonly operations: FakeOperation[] = [];
    private readonly cursorRequests: FakeCursorRequest[] = [];
    private committed = false;
    private completed = false;

    constructor(
        private readonly persistence: SharedPersistence,
        mode: IDBTransactionMode
    ) {
        this.mode = mode;
    }

    objectStore(): {
        clear: () => FakeRequest<undefined>;
        put: (value: Uint8Array, key: string) => FakeRequest<undefined>;
        add: (value: Uint8Array, key: string) => FakeRequest<undefined>;
        getAllKeys: () => FakeRequest<string[]>;
        getAll: () => FakeRequest<Uint8Array[]>;
        openCursor: () => FakeCursorRequest;
    } {
        return {
            clear: () => {
                this.queue(() => this.persistence.records.clear());
                return createFakeRequest(undefined);
            },
            put: (value, key) => {
                this.queue(() => this.persistence.records.set(key, new Uint8Array(value)));
                return createFakeRequest(undefined);
            },
            add: (value, key) => {
                this.queue(() => {
                    if (this.persistence.records.has(key)) {
                        throw new Error(`Duplicate persisted key: ${key}`);
                    }
                    this.persistence.records.set(key, new Uint8Array(value));
                });
                return createFakeRequest(undefined);
            },
            getAllKeys: () => createFakeRequest([...this.persistence.records.keys()]),
            getAll: () =>
                createFakeRequest([...this.persistence.records.values()].map((value) => new Uint8Array(value))),
            openCursor: () => {
                const request: FakeCursorRequest = createFakeRequest(null);
                this.cursorRequests.push(request);
                return request;
            },
        };
    }

    commit(): void {
        if (this.committed) {
            return;
        }

        this.runCursors();
        try {
            for (const operation of this.operations) {
                operation();
            }
            this.committed = true;
        } catch (error) {
            this.error = error instanceof DOMException ? error : new DOMException(String(error), 'AbortError');
            this.onerror?.();
        }
    }

    complete(): void {
        if (this.completed) {
            return;
        }

        this.commit();
        this.completed = true;
        if (this.error) {
            this.onabort?.();
            return;
        }
        this.oncomplete?.();
    }

    private queue(operation: FakeOperation): void {
        this.operations.push(operation);
    }

    private runCursors(): void {
        for (const request of this.cursorRequests) {
            const keys = [...this.persistence.records.keys()];
            this.dispatchCursor(request, keys, 0);
        }
    }

    private dispatchCursor(request: FakeCursorRequest, keys: string[], keyIndex: number): void {
        const key = keys[keyIndex];
        if (key === undefined) {
            request.result = null;
            request.onsuccess?.();
            return;
        }

        request.result = {
            key,
            delete: () => this.queue(() => this.persistence.records.delete(key)),
            continue: () => this.dispatchCursor(request, keys, keyIndex + 1),
        };
        request.onsuccess?.();
    }
}

class SharedPersistence {
    readonly records = new Map<string, Uint8Array>();
    readonly database: IDBDatabase;

    private readonly transactions: SharedPersistenceTransaction[] = [];
    private readonly transactionWaiters: Array<{
        mode: IDBTransactionMode;
        occurrence: number;
        resolve: (transaction: SharedPersistenceTransaction) => void;
    }> = [];

    constructor() {
        const database = { transaction: this.createTransaction.bind(this) };
        this.database = database as unknown as IDBDatabase;
    }

    private createTransaction(_storeName: string, mode: IDBTransactionMode = 'readonly'): SharedPersistenceTransaction {
        const transaction = new SharedPersistenceTransaction(this, mode);
        this.transactions.push(transaction);
        this.resolveTransactionWaiters();
        return transaction;
    }

    seed(key: string, value: Uint8Array): void {
        this.records.set(key, new Uint8Array(value));
    }

    waitForTransaction(mode: IDBTransactionMode, occurrence: number): Promise<SharedPersistenceTransaction> {
        const matchingTransactions = this.transactions.filter((transaction) => transaction.mode === mode);
        const existingTransaction = matchingTransactions[occurrence - 1];
        if (existingTransaction) {
            return Promise.resolve(existingTransaction);
        }

        return new Promise((resolve) => {
            this.transactionWaiters.push({ mode, occurrence, resolve });
        });
    }

    private resolveTransactionWaiters(): void {
        for (let index = this.transactionWaiters.length - 1; index >= 0; index--) {
            const waiter = this.transactionWaiters[index];
            const matchingTransactions = this.transactions.filter((transaction) => transaction.mode === waiter.mode);
            const transaction = matchingTransactions[waiter.occurrence - 1];
            if (!transaction) {
                continue;
            }

            this.transactionWaiters.splice(index, 1);
            waiter.resolve(transaction);
        }
    }
}

const mocks = vi.hoisted(() => ({
    saveAll: vi.fn(() => new Map<string, Uint8Array>()),
    openDatabase: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        saveAll: mocks.saveAll,
    },
}));
vi.mock('../../repositories/crdtPersistence/helpers', () => ({
    STORE_NAME: 'documents',
    openDatabase: mocks.openDatabase,
}));

async function readPersistedBundle(
    persistence: SharedPersistence
): Promise<Awaited<ReturnType<typeof loadAllFromIdb>>> {
    const load = loadAllFromIdb();
    const transaction = await persistence.waitForTransaction('readonly', 1);
    transaction.complete();
    return load;
}

describe('compactProject', () => {
    let persistence: SharedPersistence;

    beforeEach(() => {
        vi.clearAllMocks();
        persistence = new SharedPersistence();
        mocks.openDatabase.mockResolvedValue(persistence.database);
        crdtProjectCompactionState.incrementalSaveCount = 0;
    });

    it('should write the full bundle and reset the incremental count', async () => {
        const mockBundle = new Map([['doc1', new Uint8Array([4, 5, 6])]]);
        mocks.saveAll.mockReturnValue(mockBundle);
        crdtProjectCompactionState.incrementalSaveCount = 3;

        const compaction = compactProject();
        const fullSave = await persistence.waitForTransaction('readwrite', 1);
        fullSave.complete();
        await compaction;

        expect(mocks.saveAll).toHaveBeenCalledOnce();
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(0);
    });

    it('should preserve an incremental created after the full snapshot commits', async () => {
        const snapshot = new Uint8Array([4, 5, 6]);
        const postSnapshotIncremental = new Uint8Array([7, 8, 9]);
        const mockBundle = new Map([['root', snapshot]]);
        const beforeSnapshotIncrementalKey = 'root:incremental:before-snapshot';
        mocks.saveAll.mockReturnValue(mockBundle);
        persistence.seed(beforeSnapshotIncrementalKey, new Uint8Array([1, 2, 3]));

        const compaction = compactProject();
        const fullSave = await persistence.waitForTransaction('readwrite', 1);
        fullSave.commit();
        expect([...persistence.records.keys()]).toEqual(['root']);

        const incrementalSave = saveIncrementalToIdb('root', postSnapshotIncremental);
        const incrementalTransaction = await persistence.waitForTransaction('readwrite', 2);
        incrementalTransaction.complete();
        await incrementalSave;

        const possibleObsoleteCleanup = persistence.waitForTransaction('readwrite', 3);
        fullSave.complete();
        const cleanupOrCompletion = await Promise.race([compaction.then(() => null), possibleObsoleteCleanup]);
        cleanupOrCompletion?.complete();
        await compaction;

        const persisted = await readPersistedBundle(persistence);
        const incrementalEntries = [...(persisted ?? new Map<string, Uint8Array>()).entries()].filter(([key]) =>
            key.startsWith('root:incremental:')
        );

        expect(persisted?.get('root')).toEqual(snapshot);
        expect(persisted?.has(beforeSnapshotIncrementalKey)).toBe(false);
        expect(incrementalEntries).toHaveLength(1);
        expect(incrementalEntries[0]?.[1]).toEqual(postSnapshotIncremental);
    });

    it('should propagate full-save failures without resetting the incremental count', async () => {
        const failure = new Error('full save failed');
        crdtProjectCompactionState.incrementalSaveCount = 7;
        mocks.openDatabase.mockRejectedValue(failure);

        await expect(compactProject()).rejects.toBe(failure);
        expect(crdtProjectCompactionState.incrementalSaveCount).toBe(7);
    });
});

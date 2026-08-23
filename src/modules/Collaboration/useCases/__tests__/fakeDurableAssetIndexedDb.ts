import { vi } from 'vitest';

type FakeRequest<Result = unknown> = {
    result: Result | undefined;
    error: DOMException | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

type StoredRecord = Record<string, unknown>;
type FakeIndexDefinition = { keyPath: string; multiEntry: boolean };

class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: DOMException | null = null;

    private operations: Array<() => void> = [];
    private settled = false;
    private readonly storeSnapshots = new Map<string, Map<string, StoredRecord>>();

    constructor(
        private readonly stores: Map<string, Map<string, StoredRecord>>,
        private readonly indexes: Map<string, Map<string, FakeIndexDefinition>>,
        private readonly storeNames: readonly string[],
        private readonly mode: IDBTransactionMode,
        private readonly onFullScan: () => void = () => undefined,
        private readonly failOnComplete = false
    ) {
        if (mode === 'readwrite') {
            for (const storeName of storeNames) {
                this.storeSnapshots.set(storeName, new Map(stores.get(storeName)));
            }
        }
        queueMicrotask(() => this.flush());
    }

    objectStore(name: string): FakeObjectStore {
        if (!this.storeNames.includes(name)) {
            throw new DOMException(`Unknown object store: ${name}`, 'NotFoundError');
        }
        const store = this.stores.get(name);
        if (!store) {
            throw new DOMException(`Unknown object store: ${name}`, 'NotFoundError');
        }
        return new FakeObjectStore(this, name, store, this.indexes.get(name) ?? new Map(), this.onFullScan);
    }

    enqueue(operation: () => void): void {
        if (this.settled) {
            throw new DOMException('The transaction is inactive', 'TransactionInactiveError');
        }
        this.operations.push(operation);
    }

    abort(): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        for (const [storeName, snapshot] of this.storeSnapshots) {
            const store = this.stores.get(storeName);
            if (!store) {
                continue;
            }
            store.clear();
            for (const [key, value] of snapshot) {
                store.set(key, value);
            }
        }
        this.error = new DOMException('The transaction was aborted', 'AbortError');
        this.onabort?.();
    }

    private flush(): void {
        if (this.settled) {
            return;
        }
        const operations = this.operations.splice(0, this.operations.length);
        for (const operation of operations) {
            operation();
        }
        // Promise continuations from request success run before this check and
        // may enqueue the writes that belong to the still-active transaction.
        queueMicrotask(() => {
            queueMicrotask(() => {
                if (this.settled) {
                    return;
                }
                if (this.operations.length > 0) {
                    this.flush();
                    return;
                }
                if (this.failOnComplete) {
                    this.abort();
                    return;
                }
                this.settled = true;
                this.oncomplete?.();
            });
        });
    }

    assertWritable(): void {
        if (this.mode !== 'readwrite') {
            throw new DOMException('The transaction is read-only', 'ReadOnlyError');
        }
    }
}

class FakeObjectStore {
    constructor(
        private readonly transaction: FakeTransaction,
        private readonly storeName: string,
        private readonly values: Map<string, StoredRecord>,
        private readonly indexes: Map<string, FakeIndexDefinition>,
        private readonly onFullScan: () => void = () => undefined
    ) {}

    readonly indexNames = { contains: (name: string) => this.indexes.has(name) };

    createIndex(name: string, keyPath: string, options?: IDBIndexParameters) {
        this.indexes.set(name, { keyPath, multiEntry: options?.multiEntry === true });
        return this.index(name);
    }

    index(name: string): { getAll: (key: string) => FakeRequest<StoredRecord[]> } {
        const definition = this.indexes.get(name);
        if (!definition) {
            throw new DOMException(`Unknown index: ${name}`, 'NotFoundError');
        }
        return {
            getAll: (key) =>
                this.request(() =>
                    [...this.values.values()].filter((value) => {
                        const indexed = value[definition.keyPath];
                        return definition.multiEntry && Array.isArray(indexed)
                            ? indexed.includes(key)
                            : indexed === key;
                    })
                ),
        };
    }

    get(key: string): FakeRequest<StoredRecord | undefined> {
        return this.request(() => this.values.get(key));
    }

    getAll(): FakeRequest<StoredRecord[]> {
        this.onFullScan();
        return this.request(() => [...this.values.values()]);
    }

    put(value: StoredRecord): FakeRequest<IDBValidKey> {
        this.transaction.assertWritable();
        let key = value.hash;
        if (this.storeName === 'leases') {
            key = value.leaseId;
        } else if (this.storeName === 'ownerHandoffs') {
            key = value.previousOwnerId;
        }
        if (typeof key !== 'string') {
            throw new DOMException('The record has no supported key', 'DataError');
        }
        return this.request(() => {
            this.values.set(key, value);
            return key;
        });
    }

    delete(key: string): FakeRequest<undefined> {
        this.transaction.assertWritable();
        return this.request(() => {
            this.values.delete(key);
            return undefined;
        });
    }

    private request<Result>(operation: () => Result): FakeRequest<Result> {
        const request: FakeRequest<Result> = { result: undefined, error: null, onsuccess: null, onerror: null };
        this.transaction.enqueue(() => {
            request.result = operation();
            request.onsuccess?.();
        });
        return request;
    }
}

export type FakeDurableAssetIndexedDb = {
    reset: () => void;
    deleteAsset: (hash: string) => void;
    overwriteAssetBlob: (hash: string, blob: Blob) => void;
    overwriteLeaseHash: (leaseId: string, hash: string) => void;
    overwriteLeaseTerminalAt: (leaseId: string, terminalAt: number) => void;
    seedPromotedLease: (input: { leaseId: string; ownerId: string; hash: string; terminalAt: number }) => void;
    unlinkLeaseFromAsset: (leaseId: string, hash: string) => void;
    countRecords: (store: 'assets' | 'leases' | 'ownerHandoffs') => number;
    failNextReadwriteTransactions: (count: number) => void;
    getFullScanCount: () => number;
};

/** Install the exact two-store IndexedDB surface the durable asset owner uses. */
export function installFakeDurableAssetIndexedDb(): FakeDurableAssetIndexedDb {
    const stores = new Map<string, Map<string, StoredRecord>>();
    const indexes = new Map<string, Map<string, FakeIndexDefinition>>();
    let fullScanCount = 0;
    let failedReadwriteTransactionsRemaining = 0;
    const database = {
        objectStoreNames: {
            contains: (name: string) => stores.has(name),
        },
        createObjectStore: (name: string) => {
            stores.set(name, new Map());
            const storeIndexes = new Map<string, FakeIndexDefinition>();
            indexes.set(name, storeIndexes);
            const transaction = new FakeTransaction(stores, indexes, [name], 'readwrite');
            return new FakeObjectStore(transaction, name, stores.get(name)!, storeIndexes, () => {
                fullScanCount += 1;
            });
        },
        close: () => undefined,
        onversionchange: null as (() => void) | null,
        transaction: (names: string | string[], mode: IDBTransactionMode = 'readonly') => {
            const shouldFail = mode === 'readwrite' && failedReadwriteTransactionsRemaining > 0;
            if (shouldFail) {
                failedReadwriteTransactionsRemaining -= 1;
            }
            return new FakeTransaction(
                stores,
                indexes,
                Array.isArray(names) ? names : [names],
                mode,
                () => {
                    fullScanCount += 1;
                },
                shouldFail
            );
        },
    };
    vi.stubGlobal('indexedDB', {
        open: () => {
            const request = {
                result: database,
                transaction: new FakeTransaction(stores, indexes, [...stores.keys()], 'readwrite'),
                error: null as DOMException | null,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onblocked: null as (() => void) | null,
                onupgradeneeded: null as ((event: { oldVersion: number }) => void) | null,
            };
            queueMicrotask(() => {
                request.onupgradeneeded?.({ oldVersion: 0 });
                request.onsuccess?.();
            });
            return request;
        },
    });
    return {
        reset: () => {
            for (const store of stores.values()) {
                store.clear();
            }
            fullScanCount = 0;
            failedReadwriteTransactionsRemaining = 0;
        },
        deleteAsset: (hash) => {
            stores.get('assets')?.delete(hash);
        },
        overwriteAssetBlob: (hash, blob) => {
            const assetStore = stores.get('assets');
            const asset = assetStore?.get(hash);
            if (asset) {
                assetStore?.set(hash, { ...asset, blob });
            }
        },
        overwriteLeaseHash: (leaseId, hash) => {
            const leaseStore = stores.get('leases');
            const lease = leaseStore?.get(leaseId);
            if (lease) {
                leaseStore?.set(leaseId, { ...lease, hash });
            }
        },
        overwriteLeaseTerminalAt: (leaseId, terminalAt) => {
            const leaseStore = stores.get('leases');
            const lease = leaseStore?.get(leaseId);
            if (lease) {
                leaseStore?.set(leaseId, { ...lease, terminalAt });
            }
        },
        seedPromotedLease: ({ leaseId, ownerId, hash, terminalAt }) => {
            stores.get('leases')?.set(leaseId, {
                schemaVersion: 2,
                leaseId,
                ownerId,
                hash,
                state: 'promoted',
                terminalAt,
            });
        },
        unlinkLeaseFromAsset: (leaseId, hash) => {
            const assetStore = stores.get('assets');
            const asset = assetStore?.get(hash);
            if (asset && Array.isArray(asset.activeLeases)) {
                assetStore?.set(hash, {
                    ...asset,
                    activeLeases: asset.activeLeases.filter(
                        (value) => typeof value !== 'object' || value === null || value.leaseId !== leaseId
                    ),
                });
            }
        },
        countRecords: (store) => stores.get(store)?.size ?? 0,
        failNextReadwriteTransactions: (count) => {
            failedReadwriteTransactionsRemaining = count;
        },
        getFullScanCount: () => fullScanCount,
    };
}

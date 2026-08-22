import { vi } from 'vitest';

type FakeRequest<Result = unknown> = {
    result: Result | undefined;
    error: DOMException | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

type StoredRecord = Record<string, unknown>;

class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: DOMException | null = null;

    private operations: Array<() => void> = [];
    private settled = false;

    constructor(
        private readonly stores: Map<string, Map<string, StoredRecord>>,
        private readonly storeNames: readonly string[],
        private readonly mode: IDBTransactionMode
    ) {
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
        return new FakeObjectStore(this, name, store);
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
        private readonly values: Map<string, StoredRecord>
    ) {}

    get(key: string): FakeRequest<StoredRecord | undefined> {
        return this.request(() => this.values.get(key));
    }

    getAll(): FakeRequest<StoredRecord[]> {
        return this.request(() => [...this.values.values()]);
    }

    put(value: StoredRecord): FakeRequest<IDBValidKey> {
        this.transaction.assertWritable();
        const key = this.storeName === 'leases' ? value.leaseId : value.hash;
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
    unlinkLeaseFromAsset: (leaseId: string, hash: string) => void;
};

/** Install the exact two-store IndexedDB surface the durable asset owner uses. */
export function installFakeDurableAssetIndexedDb(): FakeDurableAssetIndexedDb {
    const stores = new Map<string, Map<string, StoredRecord>>();
    const database = {
        objectStoreNames: {
            contains: (name: string) => stores.has(name),
        },
        createObjectStore: (name: string) => {
            stores.set(name, new Map());
            return {};
        },
        close: () => undefined,
        onversionchange: null as (() => void) | null,
        transaction: (names: string | string[], mode: IDBTransactionMode = 'readonly') =>
            new FakeTransaction(stores, Array.isArray(names) ? names : [names], mode),
    };
    vi.stubGlobal('indexedDB', {
        open: () => {
            const request = {
                result: database,
                error: null as DOMException | null,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onblocked: null as (() => void) | null,
                onupgradeneeded: null as (() => void) | null,
            };
            queueMicrotask(() => {
                request.onupgradeneeded?.();
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
    };
}

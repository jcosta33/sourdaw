import { vi } from 'vitest';

type StoredRecord = Record<string, unknown>;
type IndexDefinition = { keyPath: string; multiEntry: boolean };
type FakeRequest<Result = unknown> = {
    result: Result | undefined;
    error: DOMException | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};
type DatabaseState = {
    version: number;
    stores: Map<string, Map<string, StoredRecord>>;
    indexes: Map<string, Map<string, IndexDefinition>>;
    active: Set<FakeTransaction>;
    pending: FakeTransaction[];
};

function cloneRecord(value: StoredRecord): StoredRecord {
    const cloned = structuredClone(value);
    if (value.blob instanceof Blob) {
        cloned.blob = value.blob.slice(0, value.blob.size, value.blob.type);
    }
    return cloned;
}

function cloneStore(value?: Map<string, StoredRecord>): Map<string, StoredRecord> {
    return new Map([...(value ?? [])].map(([key, record]) => [key, cloneRecord(record)]));
}

function cloneIndexes(value?: Map<string, IndexDefinition>): Map<string, IndexDefinition> {
    return new Map([...(value ?? [])].map(([key, definition]) => [key, { ...definition }]));
}

function schedule(state: DatabaseState): void {
    for (let index = 0; index < state.pending.length;) {
        const candidate = state.pending[index]!;
        if ([...state.active].some((active) => candidate.conflictsWith(active))) {
            index += 1;
            continue;
        }
        state.pending.splice(index, 1);
        state.active.add(candidate);
        candidate.activate();
    }
}

class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: DOMException | null = null;

    private active = false;
    private settled = false;
    private readonly operations: Array<() => void> = [];
    private readonly localStores = new Map<string, Map<string, StoredRecord>>();
    private readonly localIndexes = new Map<string, Map<string, IndexDefinition>>();
    private upgradeBody: (() => void) | null = null;
    private completeInternal: (() => void) | null = null;
    private abortInternal: (() => void) | null = null;

    constructor(
        private readonly state: DatabaseState,
        private storeNames: string[],
        readonly mode: IDBTransactionMode,
        private readonly onFullScan: () => void,
        private readonly failOnComplete = false
    ) {}

    conflictsWith(other: FakeTransaction): boolean {
        if (this.mode === 'versionchange' || other.mode === 'versionchange') {
            return true;
        }
        const overlaps = this.storeNames.some((name) => other.storeNames.includes(name));
        return overlaps && (this.mode === 'readwrite' || other.mode === 'readwrite');
    }

    setUpgradeCallbacks(input: { body: () => void; complete: () => void; abort: () => void }): void {
        this.upgradeBody = input.body;
        this.completeInternal = input.complete;
        this.abortInternal = input.abort;
    }

    activate(): void {
        if (this.settled) {
            return;
        }
        this.active = true;
        const names = this.mode === 'versionchange' ? [...this.state.stores.keys()] : this.storeNames;
        for (const name of names) {
            this.localStores.set(name, cloneStore(this.state.stores.get(name)));
            this.localIndexes.set(name, cloneIndexes(this.state.indexes.get(name)));
        }
        try {
            this.upgradeBody?.();
        } catch {
            this.abort();
            return;
        }
        this.flush();
    }

    objectStore(name: string): FakeObjectStore {
        if (!this.storeNames.includes(name)) {
            throw new DOMException(`Unknown object store: ${name}`, 'NotFoundError');
        }
        return new FakeObjectStore(this, name, this.onFullScan);
    }

    createObjectStore(name: string): FakeObjectStore {
        if (!this.active || this.mode !== 'versionchange' || this.localStores.has(name)) {
            throw new DOMException(`Cannot create object store: ${name}`, 'InvalidStateError');
        }
        this.storeNames.push(name);
        this.localStores.set(name, new Map());
        this.localIndexes.set(name, new Map());
        return new FakeObjectStore(this, name, this.onFullScan);
    }

    hasStore(name: string): boolean {
        return this.active ? this.localStores.has(name) : this.state.stores.has(name);
    }

    store(name: string): Map<string, StoredRecord> {
        const store = this.localStores.get(name);
        if (!store) {
            throw new DOMException(`Unknown object store: ${name}`, 'NotFoundError');
        }
        return store;
    }

    indexes(name: string): Map<string, IndexDefinition> {
        const indexes = this.localIndexes.get(name);
        if (!indexes) {
            throw new DOMException(`Unknown object store: ${name}`, 'NotFoundError');
        }
        return indexes;
    }

    indexDefinition(storeName: string, indexName: string): IndexDefinition | undefined {
        return this.active
            ? this.localIndexes.get(storeName)?.get(indexName)
            : this.state.indexes.get(storeName)?.get(indexName);
    }

    enqueue(operation: () => void): void {
        if (this.settled) {
            throw new DOMException('The transaction is inactive', 'TransactionInactiveError');
        }
        this.operations.push(operation);
        if (this.active) {
            queueMicrotask(() => this.flush());
        }
    }

    assertWritable(): void {
        if (this.mode !== 'readwrite' && this.mode !== 'versionchange') {
            throw new DOMException('The transaction is read-only', 'ReadOnlyError');
        }
    }

    abort(): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        this.active = false;
        this.error = new DOMException('The transaction was aborted', 'AbortError');
        this.abortInternal?.();
        this.onabort?.();
        this.finishScheduling();
    }

    private flush(): void {
        if (!this.active || this.settled) {
            return;
        }
        for (const operation of this.operations.splice(0)) {
            operation();
        }
        queueMicrotask(() => {
            queueMicrotask(() => {
                if (!this.active || this.settled) {
                    return;
                }
                if (this.operations.length > 0) {
                    this.flush();
                } else if (this.failOnComplete) {
                    this.abort();
                } else {
                    this.commit();
                }
            });
        });
    }

    private commit(): void {
        if (this.mode === 'readwrite' || this.mode === 'versionchange') {
            for (const name of this.storeNames) {
                this.state.stores.set(name, cloneStore(this.localStores.get(name)));
                this.state.indexes.set(name, cloneIndexes(this.localIndexes.get(name)));
            }
        }
        this.settled = true;
        this.active = false;
        this.completeInternal?.();
        this.oncomplete?.();
        this.finishScheduling();
    }

    private finishScheduling(): void {
        this.state.active.delete(this);
        schedule(this.state);
    }
}

class FakeObjectStore {
    constructor(
        private readonly transaction: FakeTransaction,
        private readonly storeName: string,
        private readonly onFullScan: () => void
    ) {}

    readonly indexNames = {
        contains: (name: string) => this.transaction.indexDefinition(this.storeName, name) !== undefined,
    };

    createIndex(name: string, keyPath: string, options?: IDBIndexParameters) {
        this.transaction.assertWritable();
        this.transaction.indexes(this.storeName).set(name, { keyPath, multiEntry: options?.multiEntry === true });
        return this.index(name);
    }

    index(name: string): { getAll: (key: string) => FakeRequest<StoredRecord[]> } {
        if (!this.transaction.indexDefinition(this.storeName, name)) {
            throw new DOMException(`Unknown index: ${name}`, 'NotFoundError');
        }
        return {
            getAll: (key) =>
                this.request(() => {
                    const definition = this.transaction.indexDefinition(this.storeName, name);
                    if (!definition) {
                        throw new DOMException(`Unknown index: ${name}`, 'NotFoundError');
                    }
                    return [...this.transaction.store(this.storeName).values()]
                        .filter((record) => {
                            const indexed = record[definition.keyPath];
                            return definition.multiEntry && Array.isArray(indexed)
                                ? indexed.includes(key)
                                : indexed === key;
                        })
                        .map(cloneRecord);
                }),
        };
    }

    get(key: string): FakeRequest<StoredRecord | undefined> {
        return this.request(() => {
            const record = this.transaction.store(this.storeName).get(key);
            return record ? cloneRecord(record) : undefined;
        });
    }

    getAll(): FakeRequest<StoredRecord[]> {
        this.onFullScan();
        return this.request(() => [...this.transaction.store(this.storeName).values()].map(cloneRecord));
    }

    openCursor(): FakeRequest<IDBCursorWithValue | null> {
        const request: FakeRequest<IDBCursorWithValue | null> = {
            result: undefined,
            error: null,
            onsuccess: null,
            onerror: null,
        };
        let entries: Array<[string, StoredRecord]> | undefined;
        let position = 0;
        const advance = () => {
            this.transaction.enqueue(() => {
                entries ??= [...this.transaction.store(this.storeName).entries()];
                const entry = entries[position];
                if (!entry) {
                    request.result = null;
                    request.onsuccess?.();
                    return;
                }
                const [key, value] = entry;
                request.result = {
                    key,
                    primaryKey: key,
                    value: cloneRecord(value),
                    update: (replacement: StoredRecord) => this.put(replacement),
                    continue: () => {
                        position += 1;
                        advance();
                    },
                } as unknown as IDBCursorWithValue;
                request.onsuccess?.();
            });
        };
        advance();
        return request;
    }

    put(value: StoredRecord): FakeRequest<IDBValidKey> {
        this.transaction.assertWritable();
        let candidate = value.hash;
        if (this.storeName === 'leases') {
            candidate = value.leaseId;
        } else if (this.storeName === 'ownerHandoffs') {
            candidate = value.previousOwnerId;
        } else if (this.storeName === 'promotionRecoveries') {
            candidate = value.recoveryId;
        } else if (this.storeName === 'ownerAuthorities') {
            candidate = value.ownerId;
        }
        if (typeof candidate !== 'string') {
            throw new DOMException('The record has no supported key', 'DataError');
        }
        return this.request(() => {
            this.transaction.store(this.storeName).set(candidate, cloneRecord(value));
            return candidate;
        });
    }

    delete(key: string): FakeRequest<undefined> {
        this.transaction.assertWritable();
        return this.request(() => {
            this.transaction.store(this.storeName).delete(key);
            return undefined;
        });
    }

    private request<Result>(operation: () => Result): FakeRequest<Result> {
        const request: FakeRequest<Result> = { result: undefined, error: null, onsuccess: null, onerror: null };
        this.transaction.enqueue(() => {
            try {
                request.result = operation();
                request.onsuccess?.();
            } catch (error) {
                request.error = error instanceof DOMException ? error : new DOMException(String(error), 'UnknownError');
                request.onerror?.();
                this.transaction.abort();
            }
        });
        return request;
    }
}

class FakeDatabase {
    onversionchange: (() => void) | null = null;
    currentUpgrade: FakeTransaction | null = null;

    constructor(
        private readonly state: DatabaseState,
        private readonly shouldFailReadwrite: () => boolean,
        private readonly onFullScan: () => void
    ) {}

    readonly objectStoreNames = { contains: (name: string) => this.state.stores.has(name) };

    createObjectStore(name: string): FakeObjectStore {
        if (!this.currentUpgrade) {
            throw new DOMException('No versionchange transaction is active', 'InvalidStateError');
        }
        return this.currentUpgrade.createObjectStore(name);
    }

    close(): void {}

    transaction(names: string | string[], mode: IDBTransactionMode = 'readonly'): FakeTransaction {
        const storeNames = Array.isArray(names) ? names : [names];
        const transaction = new FakeTransaction(
            this.state,
            storeNames,
            mode,
            this.onFullScan,
            mode === 'readwrite' && this.shouldFailReadwrite()
        );
        this.state.pending.push(transaction);
        queueMicrotask(() => schedule(this.state));
        return transaction;
    }
}

export type FakeDurableAssetIndexedDb = {
    reset: () => void;
    deleteAsset: (hash: string) => void;
    overwriteAssetBlob: (hash: string, blob: Blob) => void;
    overwriteLeaseHash: (leaseId: string, hash: string) => void;
    overwriteLeaseTerminalAt: (leaseId: string, terminalAt: number) => void;
    seedPromotedLease: (input: { leaseId: string; ownerId: string; hash: string; terminalAt: number }) => void;
    seedOwnerHandoff: (input: { previousOwnerId: string; nextOwnerId: string }) => void;
    unlinkLeaseFromAsset: (leaseId: string, hash: string) => void;
    countRecords: (store: 'assets' | 'leases' | 'ownerHandoffs' | 'promotionRecoveries') => number;
    failNextReadwriteTransactions: (count: number) => void;
    getFullScanCount: () => number;
};

/** Install an IndexedDB double with transaction-local writes, scope scheduling, and atomic upgrades. */
export function installFakeDurableAssetIndexedDb(): FakeDurableAssetIndexedDb {
    const databases = new Map<string, DatabaseState>();
    let fullScanCount = 0;
    let failedReadwriteTransactions = 0;

    function shouldFailReadwrite(): boolean {
        if (failedReadwriteTransactions === 0) {
            return false;
        }
        failedReadwriteTransactions -= 1;
        return true;
    }

    vi.stubGlobal('indexedDB', {
        open: (name: string, requestedVersion?: number) => {
            let state = databases.get(name);
            if (!state) {
                state = {
                    version: 0,
                    stores: new Map(),
                    indexes: new Map(),
                    active: new Set(),
                    pending: [],
                };
                databases.set(name, state);
            }
            const database = new FakeDatabase(state, shouldFailReadwrite, () => {
                fullScanCount += 1;
            });
            const version = requestedVersion ?? Math.max(1, state.version);
            const request = {
                result: database,
                transaction: null as FakeTransaction | null,
                error: null as DOMException | null,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onblocked: null as (() => void) | null,
                onupgradeneeded: null as ((event: { oldVersion: number; newVersion: number }) => void) | null,
            };
            queueMicrotask(() => {
                if (version === state.version) {
                    request.onsuccess?.();
                    return;
                }
                const oldVersion = state.version;
                const upgrade = new FakeTransaction(state, [...state.stores.keys()], 'versionchange', () => undefined);
                request.transaction = upgrade;
                database.currentUpgrade = upgrade;
                upgrade.setUpgradeCallbacks({
                    body: () => request.onupgradeneeded?.({ oldVersion, newVersion: version }),
                    complete: () => {
                        state.version = version;
                        database.currentUpgrade = null;
                        request.onsuccess?.();
                    },
                    abort: () => {
                        database.currentUpgrade = null;
                        request.error = upgrade.error;
                        request.onerror?.();
                    },
                });
                state.pending.push(upgrade);
                schedule(state);
            });
            return request as unknown as IDBOpenDBRequest;
        },
    });

    function durableState(): DatabaseState | undefined {
        return [...databases.values()].find((state) => state.stores.has('assets'));
    }
    function durableStore(name: string): Map<string, StoredRecord> | undefined {
        return durableState()?.stores.get(name);
    }

    return {
        reset: () => {
            for (const state of databases.values()) {
                for (const store of state.stores.values()) {
                    store.clear();
                }
            }
            fullScanCount = 0;
            failedReadwriteTransactions = 0;
        },
        deleteAsset: (hash) => {
            durableStore('assets')?.delete(hash);
        },
        overwriteAssetBlob: (hash, blob) => {
            const store = durableStore('assets');
            const record = store?.get(hash);
            if (record) {
                store?.set(hash, { ...record, blob });
            }
        },
        overwriteLeaseHash: (leaseId, hash) => {
            const store = durableStore('leases');
            const record = store?.get(leaseId);
            if (record) {
                store?.set(leaseId, { ...record, hash });
            }
        },
        overwriteLeaseTerminalAt: (leaseId, terminalAt) => {
            const store = durableStore('leases');
            const record = store?.get(leaseId);
            if (record) {
                store?.set(leaseId, { ...record, terminalAt });
            }
        },
        seedPromotedLease: ({ leaseId, ownerId, hash, terminalAt }) => {
            durableStore('leases')?.set(leaseId, {
                schemaVersion: 2,
                leaseId,
                ownerId,
                hash,
                state: 'promoted',
                terminalAt,
            });
        },
        seedOwnerHandoff: ({ previousOwnerId, nextOwnerId }) => {
            durableStore('ownerHandoffs')?.set(previousOwnerId, {
                schemaVersion: 1,
                previousOwnerId,
                nextOwnerId,
                preparedAt: Date.now(),
            });
        },
        unlinkLeaseFromAsset: (leaseId, hash) => {
            const store = durableStore('assets');
            const asset = store?.get(hash);
            if (asset && Array.isArray(asset.activeLeases)) {
                store?.set(hash, {
                    ...asset,
                    activeLeases: asset.activeLeases.filter(
                        (value) => typeof value !== 'object' || value === null || value.leaseId !== leaseId
                    ),
                });
            }
        },
        countRecords: (store) => durableStore(store)?.size ?? 0,
        failNextReadwriteTransactions: (count) => {
            failedReadwriteTransactions = count;
        },
        getFullScanCount: () => fullScanCount,
    };
}

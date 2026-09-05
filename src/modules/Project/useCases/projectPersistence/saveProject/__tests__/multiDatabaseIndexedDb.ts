import { vi } from 'vitest';

type FakeRequest<Result> = {
    error: DOMException | null;
    onerror: (() => void) | null;
    onsuccess: (() => void) | null;
    result: Result;
};

type DatabaseState = {
    activeTransaction: FakeTransaction | null;
    pendingTransactions: FakeTransaction[];
    stores: Map<string, Map<IDBValidKey, unknown>>;
    version: number;
};

type InstallMultiDatabaseIndexedDbResult = {
    abortAudioWrites: () => void;
    allowAudioWrites: () => void;
    get: (databaseName: string, storeName: string, key: IDBValidKey) => unknown;
    pauseAudioWriteSettlements: () => void;
    pauseNamedProjectWriteSettlements: () => void;
    pendingAudioWriteSettlements: () => number;
    pendingNamedProjectWriteSettlements: () => number;
    releaseNextAudioWriteSettlement: () => void;
    releaseNextNamedProjectWriteSettlement: () => void;
    rejectedAudioWriteCount: () => number;
    resumeAudioWriteSettlements: () => void;
    resumeNamedProjectWriteSettlements: () => void;
    seed: (databaseName: string, storeName: string, key: IDBValidKey, value: unknown) => void;
};

function cloneValue<Value>(value: Value): Value {
    return value === undefined ? value : structuredClone(value);
}

class FakeTransaction {
    error: DOMException | null = null;
    onabort: (() => void) | null = null;
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;

    private aborted = false;
    private readonly operations: Array<() => void> = [];
    private nextOperationIndex = 0;
    private readonly stagedByStore = new Map<string, Map<IDBValidKey, unknown>>();

    constructor(
        private readonly databaseName: string,
        private readonly database: DatabaseState,
        private readonly scope: readonly string[],
        private readonly mode: IDBTransactionMode,
        private readonly shouldAbortAudioWrite: () => boolean,
        private readonly holdAudioWriteSettlement: (settle: () => void) => void,
        private readonly isAudioWriteSettlementPaused: () => boolean,
        private readonly holdNamedProjectWriteSettlement: (settle: () => void) => void,
        private readonly isNamedProjectWriteSettlementPaused: () => boolean,
        private readonly onRejectedAudioWrite: () => void,
        private readonly onSettled: () => void
    ) {
        for (const storeName of scope) {
            this.stagedByStore.set(storeName, new Map());
        }
    }

    abort(): void {
        if (this.aborted) {
            return;
        }
        this.aborted = true;
        this.error = new DOMException('IndexedDB transaction aborted', 'AbortError');
    }

    enqueue(operation: () => void): void {
        this.operations.push(operation);
    }

    objectStore(storeName: string): FakeObjectStore {
        if (!this.scope.includes(storeName)) {
            throw new DOMException(`Object store ${storeName} is outside the transaction scope`, 'NotFoundError');
        }
        const committed = this.database.stores.get(storeName);
        const staged = this.stagedByStore.get(storeName);
        if (!committed || !staged) {
            throw new DOMException(`Object store ${storeName} does not exist`, 'NotFoundError');
        }
        return new FakeObjectStore(this, committed, staged, this.mode);
    }

    start(): void {
        setTimeout(() => this.flushRequests(), 0);
    }

    private flushRequests(): void {
        if (this.aborted) {
            this.settleAbort();
            return;
        }
        while (this.nextOperationIndex < this.operations.length) {
            this.operations[this.nextOperationIndex++]!();
        }
        setTimeout(() => {
            if (this.nextOperationIndex < this.operations.length) {
                this.flushRequests();
                return;
            }
            const isAudioWrite =
                this.databaseName === 'sourdaw-audio' && this.mode === 'readwrite' && this.scope.includes('buffers');
            const isNamedProjectWrite =
                this.databaseName === 'sourdaw-projects' &&
                this.mode === 'readwrite' &&
                this.scope.includes('projects');
            const settle = (): void => {
                if (this.aborted || (isAudioWrite && this.shouldAbortAudioWrite())) {
                    if (isAudioWrite) {
                        this.onRejectedAudioWrite();
                    }
                    this.settleAbort();
                    return;
                }
                for (const [storeName, staged] of this.stagedByStore) {
                    const committed = this.database.stores.get(storeName)!;
                    for (const [key, value] of staged) {
                        if (value === deleted) {
                            committed.delete(key);
                        } else {
                            committed.set(key, cloneValue(value));
                        }
                    }
                }
                this.oncomplete?.();
                this.onSettled();
            };
            if (isAudioWrite && this.isAudioWriteSettlementPaused()) {
                this.holdAudioWriteSettlement(settle);
                return;
            }
            if (isNamedProjectWrite && this.isNamedProjectWriteSettlementPaused()) {
                this.holdNamedProjectWriteSettlement(settle);
                return;
            }
            settle();
        }, 0);
    }

    private settleAbort(): void {
        this.error ??= new DOMException('IndexedDB transaction aborted', 'AbortError');
        this.onabort?.();
        this.onSettled();
    }
}

const deleted = Symbol('deleted');

class FakeObjectStore {
    constructor(
        private readonly transaction: FakeTransaction,
        private readonly committed: Map<IDBValidKey, unknown>,
        private readonly staged: Map<IDBValidKey, unknown>,
        private readonly mode: IDBTransactionMode
    ) {}

    add(value: unknown, key: IDBValidKey): FakeRequest<IDBValidKey> {
        return this.request(() => {
            if (this.currentValue(key) !== undefined) {
                throw new DOMException('Key already exists', 'ConstraintError');
            }
            this.assertWritable();
            this.staged.set(key, cloneValue(value));
            return key;
        });
    }

    clear(): FakeRequest<undefined> {
        return this.request(() => {
            this.assertWritable();
            for (const key of this.committed.keys()) {
                this.staged.set(key, deleted);
            }
            return undefined;
        });
    }

    delete(key: IDBValidKey): FakeRequest<undefined> {
        return this.request(() => {
            this.assertWritable();
            this.staged.set(key, deleted);
            return undefined;
        });
    }

    get(key: IDBValidKey): FakeRequest<unknown> {
        return this.request(() => cloneValue(this.currentValue(key)));
    }

    getAll(): FakeRequest<unknown[]> {
        return this.request(() => [...this.currentEntries().values()].map(cloneValue));
    }

    getAllKeys(): FakeRequest<IDBValidKey[]> {
        return this.request(() => [...this.currentEntries().keys()]);
    }

    put(value: unknown, key: IDBValidKey): FakeRequest<IDBValidKey> {
        return this.request(() => {
            this.assertWritable();
            this.staged.set(key, cloneValue(value));
            return key;
        });
    }

    private assertWritable(): void {
        if (this.mode !== 'readwrite') {
            throw new DOMException('The transaction is readonly', 'ReadOnlyError');
        }
    }

    private currentEntries(): Map<IDBValidKey, unknown> {
        const entries = new Map(this.committed);
        for (const [key, value] of this.staged) {
            if (value === deleted) {
                entries.delete(key);
            } else {
                entries.set(key, value);
            }
        }
        return entries;
    }

    private currentValue(key: IDBValidKey): unknown {
        const staged = this.staged.get(key);
        if (staged === deleted) {
            return undefined;
        }
        return this.staged.has(key) ? staged : this.committed.get(key);
    }

    private request<Result>(operation: () => Result): FakeRequest<Result> {
        const request: FakeRequest<Result> = {
            error: null,
            onerror: null,
            onsuccess: null,
            result: undefined as Result,
        };
        this.transaction.enqueue(() => {
            try {
                request.result = operation();
                request.onsuccess?.();
            } catch (error) {
                request.error =
                    error instanceof DOMException
                        ? error
                        : new DOMException(error instanceof Error ? error.message : String(error), 'UnknownError');
                request.onerror?.();
                this.transaction.abort();
            }
        });
        return request;
    }
}

export function installMultiDatabaseIndexedDb(): InstallMultiDatabaseIndexedDbResult {
    const databases = new Map<string, DatabaseState>();
    const pendingAudioSettlements: Array<() => void> = [];
    const pendingNamedProjectSettlements: Array<() => void> = [];
    let rejectAudioWrites = false;
    let pauseAudioSettlements = false;
    let pauseNamedProjectSettlements = false;
    let rejectedAudioWrites = 0;

    function databaseState(name: string): DatabaseState {
        const existing = databases.get(name);
        if (existing) {
            return existing;
        }
        const created: DatabaseState = {
            activeTransaction: null,
            pendingTransactions: [],
            stores: new Map(),
            version: 0,
        };
        databases.set(name, created);
        return created;
    }

    function startNext(database: DatabaseState): void {
        if (database.activeTransaction) {
            return;
        }
        const next = database.pendingTransactions.shift();
        if (!next) {
            return;
        }
        database.activeTransaction = next;
        next.start();
    }

    vi.stubGlobal('indexedDB', {
        open: (name: string, version = 1) => {
            const database = databaseState(name);
            const connection = {
                close: (): void => undefined,
                createObjectStore: (storeName: string): undefined => {
                    if (database.stores.has(storeName)) {
                        throw new DOMException(`Object store ${storeName} already exists`, 'ConstraintError');
                    }
                    database.stores.set(storeName, new Map());
                    return undefined;
                },
                objectStoreNames: { contains: (storeName: string): boolean => database.stores.has(storeName) },
                onclose: null as (() => void) | null,
                onversionchange: null as (() => void) | null,
                transaction: (storeNames: string | string[], mode: IDBTransactionMode = 'readonly') => {
                    const scope = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
                    const transaction = new FakeTransaction(
                        name,
                        database,
                        scope,
                        mode,
                        () => rejectAudioWrites,
                        (settle) => pendingAudioSettlements.push(settle),
                        () => pauseAudioSettlements,
                        (settle) => pendingNamedProjectSettlements.push(settle),
                        () => pauseNamedProjectSettlements,
                        () => rejectedAudioWrites++,
                        () => {
                            database.activeTransaction = null;
                            startNext(database);
                        }
                    );
                    database.pendingTransactions.push(transaction);
                    startNext(database);
                    return transaction;
                },
            };
            const request = {
                error: null as DOMException | null,
                onblocked: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onsuccess: null as (() => void) | null,
                onupgradeneeded: null as (() => void) | null,
                result: connection,
            };
            setTimeout(() => {
                if (version < database.version) {
                    request.error = new DOMException('Requested version is older than the database', 'VersionError');
                    request.onerror?.();
                    return;
                }
                if (version > database.version) {
                    request.onupgradeneeded?.();
                    database.version = version;
                }
                request.onsuccess?.();
            }, 0);
            return request;
        },
    });

    return {
        abortAudioWrites: () => {
            rejectAudioWrites = true;
        },
        allowAudioWrites: () => {
            rejectAudioWrites = false;
            pauseAudioSettlements = false;
        },
        get: (databaseName, storeName, key) => databases.get(databaseName)?.stores.get(storeName)?.get(key),
        pauseAudioWriteSettlements: () => {
            pauseAudioSettlements = true;
        },
        pauseNamedProjectWriteSettlements: () => {
            pauseNamedProjectSettlements = true;
        },
        pendingAudioWriteSettlements: () => pendingAudioSettlements.length,
        pendingNamedProjectWriteSettlements: () => pendingNamedProjectSettlements.length,
        releaseNextAudioWriteSettlement: () => {
            pendingAudioSettlements.shift()?.();
        },
        releaseNextNamedProjectWriteSettlement: () => {
            pendingNamedProjectSettlements.shift()?.();
        },
        rejectedAudioWriteCount: () => rejectedAudioWrites,
        resumeAudioWriteSettlements: () => {
            pauseAudioSettlements = false;
        },
        resumeNamedProjectWriteSettlements: () => {
            pauseNamedProjectSettlements = false;
        },
        seed: (databaseName, storeName, key, value) => {
            const store = databaseState(databaseName).stores.get(storeName);
            if (!store) {
                throw new DOMException(`Object store ${storeName} does not exist`, 'NotFoundError');
            }
            store.set(key, cloneValue(value));
        },
    };
}

import { vi } from 'vitest';

/**
 * Controllable IndexedDB double for project-storage specs.
 *
 * Faithful on the two points these specs turn on:
 *
 * 1. `request.onsuccess` fires **before** the transaction commits, and it still
 *    fires on a transaction that goes on to abort (IDB 3.0 §5.6, §2.7.1). A
 *    write path that resolves on `onsuccess` therefore reports success for a
 *    write that never landed — and this double reproduces exactly that.
 * 2. The open request can be held pending, so a write issued during the
 *    page-load window (before the database handle exists) is observable.
 */

type FakeRequest<T> = {
    result: T | undefined;
    error: unknown;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

type FakeIndexedDbControls = {
    /** Committed contents of the object store. */
    values: Map<string, string>;
    /** Completes a deferred open. No-op when the open already settled. */
    completeOpen: () => void;
    /** Fails a deferred open with `request.onerror`. */
    failOpen: () => void;
    /** Aborts every subsequent readwrite transaction, after its requests succeed. */
    abortWrites: () => void;
    /**
     * Kills the live connection the way a `versionchange` from another tab or a
     * UA-forced close does: fires `onversionchange` then `onclose`, after which
     * `transaction()` throws `InvalidStateError`. A fresh `open()` still works.
     */
    closeConnection: () => void;
    /** Number of readwrite transactions opened against the database. */
    writeTransactionCount: () => number;
};

class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: unknown = null;

    private readonly operations: Array<() => void> = [];
    private settled = false;

    constructor(
        private readonly committed: Map<string, string>,
        private readonly staged: Map<string, string | null>,
        private readonly willAbort: boolean
    ) {
        queueMicrotask(() => this.flush());
    }

    enqueue(operation: () => void): void {
        this.operations.push(operation);
    }

    objectStore(): FakeObjectStore {
        return new FakeObjectStore(this, this.committed, this.staged);
    }

    private flush(): void {
        if (this.settled) {
            return;
        }
        this.settled = true;

        // Requests report success before the transaction reaches a verdict —
        // this is the ordering the whole AC-2 defect rests on.
        for (const operation of this.operations) {
            operation();
        }

        if (this.willAbort) {
            this.staged.clear();
            this.error = new Error('IDB transaction aborted');
            this.onabort?.();
            return;
        }

        for (const [key, value] of this.staged) {
            if (value === null) {
                this.committed.delete(key);
                continue;
            }
            this.committed.set(key, value);
        }
        this.staged.clear();
        this.oncomplete?.();
    }
}

class FakeObjectStore {
    constructor(
        private readonly transaction: FakeTransaction,
        private readonly committed: Map<string, string>,
        private readonly staged: Map<string, string | null>
    ) {}

    get(key: string): FakeRequest<string | null> {
        return this.request(() => this.committed.get(key) ?? null);
    }

    put(value: string, key: string): FakeRequest<undefined> {
        return this.request(() => {
            this.staged.set(key, value);
            return undefined;
        });
    }

    delete(key: string): FakeRequest<undefined> {
        return this.request(() => {
            this.staged.set(key, null);
            return undefined;
        });
    }

    private request<T>(run: () => T): FakeRequest<T> {
        const request: FakeRequest<T> = { result: undefined, error: null, onsuccess: null, onerror: null };
        this.transaction.enqueue(() => {
            request.result = run();
            request.onsuccess?.();
        });
        return request;
    }
}

type InstallFakeIndexedDbInput = {
    /** Hold the open request pending until `completeOpen`/`failOpen` is called. */
    deferOpen?: boolean;
};

export function installFakeIndexedDb({ deferOpen = false }: InstallFakeIndexedDbInput = {}): FakeIndexedDbControls {
    const values = new Map<string, string>();
    let abortWrites = false;
    let writeTransactionCount = 0;
    const pendingOpens: Array<{ succeed: () => void; fail: () => void }> = [];

    type FakeDatabase = {
        objectStoreNames: { contains: () => boolean };
        createObjectStore: () => undefined;
        close: () => void;
        onversionchange: (() => void) | null;
        onclose: (() => void) | null;
        transaction: (storeName: string, mode?: IDBTransactionMode) => FakeTransaction;
    };

    const liveDatabases: FakeDatabase[] = [];

    function createDatabase(): FakeDatabase {
        let closed = false;
        const database: FakeDatabase = {
            objectStoreNames: { contains: () => true },
            createObjectStore: () => undefined,
            close: () => {
                closed = true;
            },
            onversionchange: null,
            onclose: null,
            transaction: (_storeName: string, mode: IDBTransactionMode = 'readonly') => {
                if (closed) {
                    const error = new Error('Failed to execute transaction: The database connection is closing.');
                    error.name = 'InvalidStateError';
                    throw error;
                }
                const isWrite = mode === 'readwrite';
                if (isWrite) {
                    writeTransactionCount++;
                }
                return new FakeTransaction(values, new Map<string, string | null>(), isWrite && abortWrites);
            },
        };
        liveDatabases.push(database);
        return database;
    }

    const indexedDb = {
        open: () => {
            const database = createDatabase();
            const request: {
                result: FakeDatabase;
                error: unknown;
                onsuccess: (() => void) | null;
                onerror: (() => void) | null;
                onblocked: (() => void) | null;
                onupgradeneeded: (() => void) | null;
            } = {
                result: database,
                error: null,
                onsuccess: null,
                onerror: null,
                onblocked: null,
                onupgradeneeded: null,
            };

            const succeed = () => {
                request.onupgradeneeded?.();
                request.onsuccess?.();
            };
            const fail = () => {
                request.error = new Error('IDB open failed');
                request.onerror?.();
            };

            if (deferOpen) {
                pendingOpens.push({ succeed, fail });
                return request;
            }
            queueMicrotask(succeed);
            return request;
        },
    };

    vi.stubGlobal('indexedDB', indexedDb);

    return {
        values,
        completeOpen: () => {
            const opens = pendingOpens.splice(0, pendingOpens.length);
            for (const open of opens) {
                open.succeed();
            }
        },
        failOpen: () => {
            const opens = pendingOpens.splice(0, pendingOpens.length);
            for (const open of opens) {
                open.fail();
            }
        },
        abortWrites: () => {
            abortWrites = true;
        },
        closeConnection: () => {
            const databases = liveDatabases.splice(0, liveDatabases.length);
            for (const database of databases) {
                database.onversionchange?.();
                database.close();
                database.onclose?.();
            }
        },
        writeTransactionCount: () => writeTransactionCount,
    };
}

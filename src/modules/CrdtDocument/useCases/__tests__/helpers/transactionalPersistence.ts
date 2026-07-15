type FakeRequest<Result> = {
    result: Result;
};

export type TransactionWrite = {
    kind: 'add' | 'put';
    key: string;
    value: Uint8Array;
};

type TransactionOperation = (records: Map<string, Uint8Array>) => void;

export class TransactionalPersistenceTransaction {
    readonly mode: IDBTransactionMode;
    readonly writes: TransactionWrite[] = [];
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: DOMException | null = null;

    private readonly operations: TransactionOperation[] = [];
    private started = false;
    private completionRequested = false;
    private abortRequested = false;
    private settled = false;

    constructor(
        private readonly persistence: TransactionalPersistence,
        mode: IDBTransactionMode
    ) {
        this.mode = mode;
    }

    objectStore(): {
        clear: () => FakeRequest<undefined>;
        get: (key: string) => FakeRequest<Uint8Array | undefined> & {
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
        };
        put: (value: Uint8Array, key: string) => FakeRequest<undefined>;
        add: (value: Uint8Array, key: string) => FakeRequest<undefined>;
        getAllKeys: () => FakeRequest<string[]>;
        getAll: () => FakeRequest<Uint8Array[]>;
    } {
        return {
            clear: () => {
                this.operations.push((records) => records.clear());
                return { result: undefined };
            },
            get: (key) => {
                let successHandler: (() => void) | null = null;
                const request: FakeRequest<Uint8Array | undefined> & {
                    onsuccess: (() => void) | null;
                    onerror: (() => void) | null;
                } = {
                    result: this.persistence.records.has(key)
                        ? new Uint8Array(this.persistence.records.get(key)!)
                        : undefined,
                    onsuccess: null,
                    onerror: null,
                };
                Object.defineProperty(request, 'onsuccess', {
                    configurable: true,
                    get: () => successHandler,
                    set: (handler: (() => void) | null) => {
                        successHandler = handler;
                        handler?.();
                    },
                });
                return request;
            },
            put: (value, key) => {
                const copy = new Uint8Array(value);
                this.writes.push({ kind: 'put', key, value: copy });
                this.operations.push((records) => records.set(key, new Uint8Array(copy)));
                return { result: undefined };
            },
            add: (value, key) => {
                const copy = new Uint8Array(value);
                this.writes.push({ kind: 'add', key, value: copy });
                this.operations.push((records) => {
                    if (records.has(key)) {
                        throw new Error(`Duplicate persisted key: ${key}`);
                    }
                    records.set(key, new Uint8Array(copy));
                });
                return { result: undefined };
            },
            getAllKeys: () => ({ result: this.persistence.readKeys() }),
            getAll: () => ({ result: this.persistence.readValues() }),
        };
    }

    complete(): void {
        if (this.settled) {
            return;
        }
        this.completionRequested = true;
        this.persistence.requestComplete(this);
    }

    abort(): void {
        if (this.settled) {
            return;
        }
        this.abortRequested = true;
        this.persistence.requestAbort(this);
    }

    hasStarted(): boolean {
        return this.started;
    }

    isSettled(): boolean {
        return this.settled;
    }

    isAbortRequested(): boolean {
        return this.abortRequested;
    }

    isCompletionRequested(): boolean {
        return this.completionRequested;
    }

    start(): void {
        this.started = true;
    }

    apply(workingRecords: Map<string, Uint8Array>): void {
        for (const operation of this.operations) {
            operation(workingRecords);
        }
    }

    settleComplete(): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        this.oncomplete?.();
    }

    settleError(error: DOMException): void {
        if (this.settled) {
            return;
        }
        this.error = error;
        this.onerror?.();
        this.settled = true;
        this.onabort?.();
    }

    settleAbort(): void {
        if (this.settled) {
            return;
        }
        this.error ??= new DOMException('IDB transaction aborted', 'AbortError');
        this.settled = true;
        this.onabort?.();
    }
}

export class TransactionalPersistence {
    readonly database: IDBDatabase;
    readonly records = new Map<string, Uint8Array>();

    private readonly transactions: TransactionalPersistenceTransaction[] = [];
    private readonly queuedReadwriteTransactions: TransactionalPersistenceTransaction[] = [];
    private readonly transactionWaiters: Array<{
        mode: IDBTransactionMode;
        occurrence: number;
        resolve: (transaction: TransactionalPersistenceTransaction) => void;
    }> = [];
    private activeReadwriteTransaction: TransactionalPersistenceTransaction | null = null;

    constructor() {
        const database = {
            transaction: (_storeName: string, mode: IDBTransactionMode = 'readonly') => this.createTransaction(mode),
        };
        this.database = database as unknown as IDBDatabase;
    }

    seed(key: string, value: Uint8Array): void {
        this.records.set(key, new Uint8Array(value));
    }

    readKeys(): string[] {
        return [...this.records.keys()].sort();
    }

    readValues(): Uint8Array[] {
        return this.readKeys().map((key) => new Uint8Array(this.records.get(key)!));
    }

    getTransactions(mode?: IDBTransactionMode): TransactionalPersistenceTransaction[] {
        return mode === undefined
            ? [...this.transactions]
            : this.transactions.filter((transaction) => transaction.mode === mode);
    }

    waitForTransaction(mode: IDBTransactionMode, occurrence: number): Promise<TransactionalPersistenceTransaction> {
        const matchingTransactions = this.getTransactions(mode);
        const existingTransaction = matchingTransactions[occurrence - 1];
        if (existingTransaction) {
            return Promise.resolve(existingTransaction);
        }

        return new Promise((resolve) => {
            this.transactionWaiters.push({ mode, occurrence, resolve });
        });
    }

    requestComplete(transaction: TransactionalPersistenceTransaction): void {
        if (transaction.hasStarted() && transaction.isCompletionRequested()) {
            this.finish(transaction);
        }
    }

    requestAbort(transaction: TransactionalPersistenceTransaction): void {
        if (transaction === this.activeReadwriteTransaction) {
            this.finishAbort(transaction);
            return;
        }

        if (transaction.mode === 'readonly' && transaction.hasStarted()) {
            this.finishAbort(transaction);
            return;
        }

        if (!transaction.hasStarted()) {
            const index = this.queuedReadwriteTransactions.indexOf(transaction);
            if (index >= 0) {
                this.queuedReadwriteTransactions.splice(index, 1);
            }
            transaction.settleAbort();
        }
    }

    private createTransaction(mode: IDBTransactionMode): TransactionalPersistenceTransaction {
        const transaction = new TransactionalPersistenceTransaction(this, mode);
        this.transactions.push(transaction);
        this.resolveTransactionWaiters();

        if (mode === 'readwrite') {
            this.queuedReadwriteTransactions.push(transaction);
            this.startNextReadwriteTransaction();
        } else {
            transaction.start();
            queueMicrotask(() => transaction.complete());
        }

        return transaction;
    }

    private startNextReadwriteTransaction(): void {
        if (this.activeReadwriteTransaction) {
            return;
        }

        const transaction = this.queuedReadwriteTransactions.shift();
        if (!transaction) {
            return;
        }
        if (transaction.isSettled()) {
            this.startNextReadwriteTransaction();
            return;
        }

        this.activeReadwriteTransaction = transaction;
        transaction.start();
        if (transaction.isAbortRequested()) {
            this.finishAbort(transaction);
        } else if (transaction.isCompletionRequested()) {
            this.finish(transaction);
        }
    }

    private finish(transaction: TransactionalPersistenceTransaction): void {
        if (transaction.isSettled() || transaction.isAbortRequested()) {
            this.finishAbort(transaction);
            return;
        }

        if (transaction.mode === 'readwrite') {
            const workingRecords = new Map(
                [...this.records.entries()].map(([key, value]) => [key, new Uint8Array(value)] as const)
            );
            try {
                transaction.apply(workingRecords);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                this.finishError(transaction, new DOMException(message, 'AbortError'));
                return;
            }

            this.records.clear();
            for (const [key, value] of workingRecords) {
                this.records.set(key, value);
            }
        }

        this.releaseReadwriteTransaction(transaction);
        transaction.settleComplete();
        this.startNextReadwriteTransaction();
    }

    private finishAbort(transaction: TransactionalPersistenceTransaction): void {
        if (transaction.isSettled()) {
            return;
        }
        this.releaseReadwriteTransaction(transaction);
        transaction.settleAbort();
        this.startNextReadwriteTransaction();
    }

    private finishError(transaction: TransactionalPersistenceTransaction, error: DOMException): void {
        this.releaseReadwriteTransaction(transaction);
        transaction.settleError(error);
        this.startNextReadwriteTransaction();
    }

    private releaseReadwriteTransaction(transaction: TransactionalPersistenceTransaction): void {
        if (this.activeReadwriteTransaction === transaction) {
            this.activeReadwriteTransaction = null;
        }
    }

    private resolveTransactionWaiters(): void {
        for (let index = this.transactionWaiters.length - 1; index >= 0; index--) {
            const waiter = this.transactionWaiters[index];
            if (!waiter) {
                continue;
            }
            const matchingTransactions = this.getTransactions(waiter.mode);
            const transaction = matchingTransactions[waiter.occurrence - 1];
            if (!transaction) {
                continue;
            }

            this.transactionWaiters.splice(index, 1);
            waiter.resolve(transaction);
        }
    }
}

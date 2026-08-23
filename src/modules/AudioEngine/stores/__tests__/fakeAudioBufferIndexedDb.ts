import { vi } from 'vitest';

/**
 * Controllable IndexedDB double for the audio-buffer cache specs.
 *
 * Faithful on the points these specs turn on:
 *
 * 1. Request events are delivered as **tasks**, not microtasks (IDB 3.0 §5.6).
 *    A caller that resolves without waiting for its request therefore resolves
 *    strictly before the request has produced anything — the ordering the
 *    unobserved-write defects rest on.
 * 2. Writes are staged and become visible only when the transaction commits, so
 *    "the write landed" and "the request succeeded" are distinguishable.
 * 3. A transaction can abort **bare** — firing transaction `abort` and no
 *    transaction `error` — while requests it had not delivered fail with
 *    `AbortError`, matching the platform's separate request/transaction events.
 *    An unprevented request `error` instead bubbles through and aborts the whole
 *    transaction, so earlier writes in the same multi-ID import roll back.
 * 4. Every `open()` yields a **distinct** connection over shared stored data, and
 *    a connection that has been closed refuses `transaction()` with
 *    `InvalidStateError` (IDB 3.0 §3.3.1). A caller that keeps using a handle it
 *    already closed therefore fails here the way it fails in a browser, instead
 *    of quietly working against a single immortal double.
 * 5. The database has **named object stores**, a transaction has a **scope**, and
 *    `objectStore(name)` outside that scope throws `NotFoundError` (IDB 3.0
 *    §3.1.7). Two stores written under one transaction commit or roll back
 *    together; two stores written under two transactions do not.
 * 6. Store creation runs in `onupgradeneeded` against the stores that already
 *    exist. `existingStores` seeds that set, so a spec can start the fake at the
 *    v1 schema (`buffers` only) and watch the upgrade add the rest.
 * 7. Every value crossing the boundary is **measured**. `bytesRead` /
 *    `bytesWritten` total the structured-clone payload of each get/getAll/put,
 *    which is the quantity a full-record rewrite wastes and a metadata row does
 *    not. Counting transactions or calls cannot see that difference.
 */

export type StoredAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    lastAccessed?: number;
    sizeInBytes?: number;
};

/** The v2 metadata row. Mirrors `BufferMeta` in `audioBufferCache.ts`. */
export type StoredBufferMeta = {
    freezeProjectId?: number;
    lastAccessed: number;
    preparedOwner?: {
        schemaVersion: 1;
        createdAtMs?: number;
        leaseId: string;
        persistenceRevision?: string;
        promotionRevision?: string;
        status: 'project-owned' | 'temporary';
    };
    sizeInBytes: number;
};

export type StoredRecoveryRecord = {
    data?: StoredAudioBuffer;
    id?: string;
    metadata?: StoredBufferMeta;
    operation?: 'discard' | 'reclamation';
    revision?: string;
    schemaVersion?: 1;
    stagedAtMs?: number;
    kind?: 'prepared-audio-recovery-migration';
};

type MarkerlessRecoveryBytes = Float32Array & {
    readonly data?: undefined;
    readonly id?: undefined;
};

export type StoredRecoveryValue = StoredRecoveryRecord | MarkerlessRecoveryBytes;

export type StoredValue = StoredAudioBuffer | StoredBufferMeta | StoredRecoveryValue;

export const BUFFER_STORE = 'buffers';
export const META_STORE = 'bufferMeta';
export const RECOVERY_STORE = 'preparedBufferRecovery';
const RECOVERY_MIGRATION_MARKER_KEY = 0;

/** Structured-clone payload size of one value, in bytes.
 *
 * Not a byte-exact model of any engine's serialization — the numbers that
 * matter here differ by four orders of magnitude, so the fixed per-field cost
 * is noise. What it is exact about is the part that dominates: a
 * `Float32Array` costs its `byteLength`, so a record's PCM is counted in full
 * and a metadata row is not. */
function measureBytes(value: unknown, visited = new WeakSet<object>()): number {
    if (value === null || value === undefined) {
        return 0;
    }
    if (ArrayBuffer.isView(value)) {
        return Math.max(1, value.byteLength);
    }
    if (typeof value === 'number') {
        return 8;
    }
    if (typeof value === 'boolean') {
        return 1;
    }
    if (typeof value === 'string') {
        return value.length * 2;
    }
    if (typeof value === 'bigint') {
        return Math.max(8, value.toString().length * 2);
    }
    if (typeof value !== 'object' || visited.has(value)) {
        return 0;
    }
    visited.add(value);
    if (value instanceof ArrayBuffer) {
        return Math.max(1, value.byteLength);
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        return Math.max(1, value.size);
    }
    if (value instanceof Date) {
        return 8;
    }
    if (value instanceof RegExp) {
        return Math.max(1, (value.source.length + value.flags.length) * 2);
    }
    if (value instanceof Map) {
        let total = 1;
        for (const [key, entry] of value) {
            total += measureBytes(key, visited) + measureBytes(entry, visited);
        }
        return total;
    }
    if (value instanceof Set) {
        let total = 1;
        for (const entry of value) {
            total += measureBytes(entry, visited);
        }
        return total;
    }
    if (Array.isArray(value)) {
        return value.reduce<number>((total, entry) => total + measureBytes(entry, visited), 1);
    }
    let total = 1;
    for (const [key, entry] of Object.entries(value)) {
        total += key.length * 2 + measureBytes(entry, visited);
    }
    return total;
}

type FakeRequest<T> = {
    result: T | undefined;
    error: unknown;
    onsuccess: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
};

export type FakeAudioIndexedDbControls = {
    /** Committed contents of the `buffers` object store. */
    committed: Map<IDBValidKey, StoredAudioBuffer>;
    /** Committed contents of the `bufferMeta` object store. */
    committedMeta: Map<IDBValidKey, StoredBufferMeta>;
    /** Committed contents of the isolated prepared-recovery object store. */
    committedRecovery: Map<IDBValidKey, StoredRecoveryValue>;
    /** Object stores that exist on the database right now. */
    storeNames: () => string[];
    /** Abort every subsequent readwrite transaction, after its requests succeed. */
    abortWrites: () => void;
    /**
     * Abort only the subsequent readwrite transactions whose scope includes
     * `storeName` — a quota failure on one store, which is what a real engine
     * hands you.
     *
     * This is the control that can tell one two-store transaction apart from
     * two one-store transactions. `abortWrites` cannot: it kills both halves of
     * a split write, so the stores end up consistent by accident and the
     * atomicity guard passes on an implementation that has none.
     */
    abortWritesTo: (storeName: string) => void;
    allowWrites: () => void;
    /** Abort exactly the next readwrite transaction, then resume normal writes. */
    abortNextWrite: () => void;
    /** Fail every request issued against one store without making other stores unavailable. */
    failRequestsFrom: (storeName: string) => void;
    /** Resume request delivery for every store. */
    allowRequests: () => void;
    /** Hold readonly completion after its requests have produced their snapshots. */
    pauseReadonlySettlements: () => void;
    /** Release the oldest held readonly completion. */
    releaseNextReadonlySettlement: () => void;
    /** Readonly completions currently held after request delivery. */
    pendingReadonlySettlementCount: () => number;
    /** Hold readwrite completion after its writes have been staged. */
    pauseWriteSettlements: () => void;
    /** Release the oldest held readwrite commit or abort. */
    releaseNextWriteSettlement: () => void;
    /** Readwrite completions currently held after request delivery. */
    pendingWriteSettlementCount: () => number;
    /** Number of readwrite transactions opened against the database. */
    writeTransactionCount: () => number;
    /** Number of `indexedDB.open` calls issued against the fake. */
    openRequestCount: () => number;
    /** Number of `close()` calls across every connection handed out. */
    closeCount: () => number;
    /** Connections opened and not yet closed — a leaked handle shows up here. */
    liveConnectionCount: () => number;
    /** Bytes of stored value handed back by `get` / `getAll` since the last reset. */
    bytesRead: () => number;
    /** Bytes of stored value accepted by `put` since the last reset. */
    bytesWritten: () => number;
    /** Zero both byte counters, so a spec can measure one operation in isolation. */
    resetByteCounters: () => void;
    /** Scope (store names) of every transaction opened, in order. */
    transactionScopes: () => string[][];
    /**
     * Fire `versionchange` on the most recently opened connection, as a
     * competing upgrade or a `deleteDatabase` in another tab would.
     */
    fireVersionChange: () => void;
    /**
     * Fire `close` on the most recently opened connection, as an abnormal
     * termination (storage eviction, backing-store failure) would. Real IDB has
     * already closed the connection by the time this fires, so the fake closes
     * it too — without counting a `close()` the code under test did not make.
     */
    fireAbnormalClose: () => void;
};

type ByteMeters = {
    read: number;
    written: number;
};

type Tables = Map<string, Map<IDBValidKey, StoredValue>>;

class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: unknown = null;

    private readonly queue: Array<{ abort: () => void; run: () => void }> = [];
    private readonly staged = new Map<string, Map<IDBValidKey, StoredValue | null>>();
    private scheduled = false;
    private started = false;
    private settled = false;

    constructor(
        private readonly tables: Tables,
        private readonly scope: readonly string[],
        private readonly willAbort: boolean,
        private readonly meters: ByteMeters,
        private readonly holdSettlement?: (settle: () => void) => void,
        private readonly onSettled?: () => void,
        private readonly shouldFailRequest?: (storeName: string) => boolean
    ) {
        for (const name of scope) {
            this.staged.set(name, new Map<IDBValidKey, StoredValue | null>());
        }
    }

    start(): void {
        if (this.started || this.settled) {
            return;
        }
        this.started = true;
        this.schedule();
    }

    enqueue(operation: () => void, abort: () => void): void {
        this.queue.push({ abort, run: operation });
        this.schedule();
    }

    objectStore(name: string): FakeObjectStore {
        if (!this.scope.includes(name)) {
            // What a browser throws when a transaction is asked for a store it
            // did not name. A two-store mutation that forgot to widen its scope
            // has to fail here rather than quietly writing one store.
            throw new DOMException(
                `Failed to execute 'objectStore' on 'IDBTransaction': The specified object store was not found.`,
                'NotFoundError'
            );
        }
        const committed = this.tables.get(name);
        if (!committed) {
            throw new DOMException(
                `Failed to execute 'objectStore' on 'IDBTransaction': The specified object store was not found.`,
                'NotFoundError'
            );
        }
        return new FakeObjectStore(name, this, committed, this.staged.get(name)!, this.meters, this.shouldFailRequest);
    }

    abort(): void {
        this.settle(true);
    }

    abortFromRequest(error: unknown): void {
        this.error = error;
        this.settle(true, true);
    }

    private schedule(): void {
        if (!this.started || this.scheduled || this.settled) {
            return;
        }
        this.scheduled = true;
        setTimeout(() => {
            this.scheduled = false;
            this.drain();
        }, 0);
    }

    private drain(): void {
        if (this.settled) {
            return;
        }
        const operation = this.queue.shift();
        if (operation) {
            operation.run();
            // A handler may have queued further requests on this transaction;
            // real IDB keeps the transaction alive while that happens.
            this.schedule();
            return;
        }
        if (this.holdSettlement) {
            this.holdSettlement(() => this.settle(this.willAbort));
            return;
        }
        this.settle(this.willAbort);
    }

    private settle(abort: boolean, requestFailed = false): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        if (abort) {
            for (const operation of this.queue.splice(0)) {
                operation.abort();
            }
            // Every store in scope rolls back together — the property a
            // two-store mutation depends on for its size accounting to stay
            // consistent with its records.
            for (const staged of this.staged.values()) {
                staged.clear();
            }
            if (!requestFailed) {
                this.error = null;
            } else {
                this.onerror?.();
            }
            // A bare abort fires `abort` and nothing else. An unprevented
            // request error first bubbles through the transaction, then aborts
            // the transaction and rolls back every staged store mutation.
            this.onabort?.();
            this.onSettled?.();
            return;
        }
        for (const [name, staged] of this.staged) {
            const committed = this.tables.get(name)!;
            for (const [key, value] of staged) {
                if (value === null) {
                    committed.delete(key);
                    continue;
                }
                committed.set(key, value);
            }
            staged.clear();
        }
        this.oncomplete?.();
        this.onSettled?.();
    }
}

class FakeObjectStore {
    constructor(
        private readonly name: string,
        private readonly transaction: FakeTransaction,
        private readonly committed: Map<IDBValidKey, StoredValue>,
        private readonly staged: Map<IDBValidKey, StoredValue | null>,
        private readonly meters: ByteMeters,
        private readonly shouldFailRequest?: (storeName: string) => boolean
    ) {}

    get(key: IDBValidKey): FakeRequest<StoredValue | undefined> {
        return this.request(() => {
            const value = this.read(key) ?? undefined;
            if (!(this.name === RECOVERY_STORE && key === RECOVERY_MIGRATION_MARKER_KEY)) {
                this.meters.read += measureBytes(value);
            }
            return value;
        });
    }

    getAll(): FakeRequest<StoredValue[]> {
        return this.request(() => {
            const values = [...this.keys()].map((key) => this.read(key)!);
            this.meters.read += measureBytes(values);
            return values;
        });
    }

    getAllKeys(): FakeRequest<IDBValidKey[]> {
        return this.request(() => {
            const keys = [...this.keys()];
            this.meters.read += measureBytes(keys);
            return keys;
        });
    }

    put(value: StoredValue, key: IDBValidKey): FakeRequest<undefined> {
        // IDB structured-clones the value at `put` time, so a later mutation of
        // the caller's object cannot reach the store.
        const snapshot = structuredClone(value);
        this.meters.written += measureBytes(snapshot);
        return this.request(() => {
            this.staged.set(key, snapshot);
            return undefined;
        });
    }

    delete(key: IDBValidKey): FakeRequest<undefined> {
        return this.request(() => {
            this.staged.set(key, null);
            return undefined;
        });
    }

    clear(): FakeRequest<undefined> {
        return this.request(() => {
            for (const key of this.keys()) {
                this.staged.set(key, null);
            }
            return undefined;
        });
    }

    private keys(): IDBValidKey[] {
        const keys = new Set(this.committed.keys());
        for (const [key, value] of this.staged) {
            if (value === null) {
                keys.delete(key);
                continue;
            }
            keys.add(key);
        }
        return [...keys];
    }

    private read(key: IDBValidKey): StoredValue | null {
        // Reads hand back a structured clone, so mutating a read result cannot
        // reach the store without a `put` that commits.
        const stored = this.staged.has(key) ? this.staged.get(key) : this.committed.get(key);
        if (!stored) {
            return null;
        }
        return structuredClone(stored);
    }

    private request<T>(run: () => T): FakeRequest<T> {
        const request: FakeRequest<T> = { result: undefined, error: null, onsuccess: null, onerror: null };
        this.transaction.enqueue(
            () => {
                if (this.shouldFailRequest?.(this.name)) {
                    request.error = new DOMException('The request failed.', 'UnknownError');
                    const event = new Event('error', { bubbles: true, cancelable: true });
                    request.onerror?.(event);
                    if (!event.defaultPrevented) {
                        this.transaction.abortFromRequest(request.error);
                    }
                    return;
                }
                request.result = run();
                request.onsuccess?.(new Event('success'));
            },
            () => {
                request.error = new DOMException('The transaction was aborted.', 'AbortError');
                request.onerror?.(new Event('error', { bubbles: true, cancelable: true }));
            }
        );
        return request;
    }
}

type FakeConnection = {
    objectStoreNames: { contains: (name: string) => boolean };
    createObjectStore: (name: string) => undefined;
    onclose: (() => void) | null;
    onversionchange: (() => void) | null;
    close: () => void;
    transaction: (storeNames: string | string[], mode?: IDBTransactionMode) => FakeTransaction;
    version: number;
    isClosed: () => boolean;
    isEstablished: () => boolean;
    markEstablished: () => void;
};

type FakeOpenRequest = {
    result: FakeConnection;
    error: DOMException | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onupgradeneeded: (() => void) | null;
    onblocked: (() => void) | null;
    requestedVersion: number;
    versionChangeDispatched: boolean;
    blockedFired: boolean;
};

export type InstallFakeAudioIndexedDbInput = {
    /**
     * Object stores that already exist when the first `open()` lands. Defaults
     * to the v1 schema, so the upgrade handler under test is the thing that
     * creates anything beyond `buffers`.
     */
    existingStores?: readonly string[];
    /** Leave the v3 recovery migration incomplete so an open must retry it. */
    pendingLegacyRecoveryMigration?: boolean;
    /**
     * How `open()` behaves when another context holds a connection at the older
     * version (IDB 3.0 §3.3.1).
     *
     * - `'forever'` fires `blocked` and then **nothing else** — no `success`,
     *   no `error`. The silence is the point: a double that fired `blocked` and
     *   then `success` anyway could not show the hang, because the promise
     *   would settle either way.
     * - `'then-yields'` fires `blocked` and then `success` a task later, as a
     *   browser does when the blocking context finally closes. This is the only
     *   way to reach the branch that has to close a connection nobody is
     *   waiting for any more.
     */
    blockOpens?: 'forever' | 'then-yields';
};

export function installFakeAudioIndexedDb(input: InstallFakeAudioIndexedDbInput = {}): FakeAudioIndexedDbControls {
    const committed = new Map<IDBValidKey, StoredAudioBuffer>();
    const committedMeta = new Map<IDBValidKey, StoredBufferMeta>();
    const committedRecovery = new Map<IDBValidKey, StoredRecoveryValue>();
    if (!input.pendingLegacyRecoveryMigration) {
        committedRecovery.set(RECOVERY_MIGRATION_MARKER_KEY, {
            kind: 'prepared-audio-recovery-migration',
            schemaVersion: 1,
        });
    }
    const tables: Tables = new Map<string, Map<IDBValidKey, StoredValue>>();
    // Both concrete maps are handed to specs by identity, so they are installed
    // as the backing tables rather than copied into them.
    tables.set(BUFFER_STORE, committed);
    tables.set(META_STORE, committedMeta);
    tables.set(RECOVERY_STORE, committedRecovery);

    const existingStores = new Set<string>(input.existingStores ?? [BUFFER_STORE]);
    let databaseVersion = 1;
    if (existingStores.has(RECOVERY_STORE)) {
        databaseVersion = 3;
    } else if (existingStores.has(META_STORE)) {
        databaseVersion = 2;
    }
    const meters: ByteMeters = { read: 0, written: 0 };
    const transactionScopes: string[][] = [];
    let abortWrites = false;
    let abortWritesToStore: string | null = null;
    let abortNextWrite = false;
    let failingRequestStore: string | null = null;
    let pauseReadonlySettlements = false;
    let pauseWriteSettlements = false;
    const pendingReadonlySettlements: Array<() => void> = [];
    const pendingWriteSettlements: Array<() => void> = [];
    type ScheduledTransaction = {
        mode: IDBTransactionMode;
        scope: readonly string[];
        transaction: FakeTransaction;
    };
    const pendingTransactions: ScheduledTransaction[] = [];
    const activeTransactions: ScheduledTransaction[] = [];
    let writeTransactionCount = 0;
    let openRequestCount = 0;
    let closeCount = 0;

    // Every `open()` yields its own connection over the shared committed data,
    // exactly as a browser does. Closing one must not disturb the others.
    const connections: FakeConnection[] = [];
    const pendingOpenRequests: FakeOpenRequest[] = [];
    let openProcessingScheduled = false;

    function transactionsConflict(alpha: ScheduledTransaction, beta: ScheduledTransaction): boolean {
        return (
            (alpha.mode === 'readwrite' || beta.mode === 'readwrite') &&
            alpha.scope.some((storeName) => beta.scope.includes(storeName))
        );
    }

    function startEligibleTransactions(): void {
        for (let index = 0; index < pendingTransactions.length; index++) {
            const candidate = pendingTransactions[index]!;
            const blockedByActive = activeTransactions.some((active) => transactionsConflict(active, candidate));
            const blockedByEarlier = pendingTransactions
                .slice(0, index)
                .some((earlier) => transactionsConflict(earlier, candidate));
            if (blockedByActive || blockedByEarlier) {
                continue;
            }
            pendingTransactions.splice(index, 1);
            index--;
            activeTransactions.push(candidate);
            candidate.transaction.start();
        }
    }

    function scheduleTransaction(transaction: FakeTransaction, scope: readonly string[], mode: IDBTransactionMode) {
        const scheduled = { transaction, scope, mode };
        pendingTransactions.push(scheduled);
        startEligibleTransactions();
        return scheduled;
    }

    function finishTransaction(scheduled: ScheduledTransaction): void {
        const activeIndex = activeTransactions.indexOf(scheduled);
        if (activeIndex >= 0) {
            activeTransactions.splice(activeIndex, 1);
        } else {
            const pendingIndex = pendingTransactions.indexOf(scheduled);
            if (pendingIndex >= 0) {
                pendingTransactions.splice(pendingIndex, 1);
            }
        }
        startEligibleTransactions();
    }

    function scheduleOpenProcessing(): void {
        if (openProcessingScheduled) {
            return;
        }
        openProcessingScheduled = true;
        setTimeout(() => {
            openProcessingScheduled = false;
            processNextOpen();
        }, 0);
    }

    function finishOpen(request: FakeOpenRequest): void {
        pendingOpenRequests.shift();
        request.result.markEstablished();
        request.onsuccess?.();
        scheduleOpenProcessing();
    }

    function failOpen(request: FakeOpenRequest, error: DOMException): void {
        pendingOpenRequests.shift();
        request.error = error;
        request.onerror?.();
        scheduleOpenProcessing();
    }

    function performUpgrade(request: FakeOpenRequest): void {
        const previousStores = new Set(existingStores);
        try {
            request.onupgradeneeded?.();
            databaseVersion = request.requestedVersion;
            finishOpen(request);
        } catch (error) {
            existingStores.clear();
            for (const storeName of previousStores) {
                existingStores.add(storeName);
            }
            failOpen(
                request,
                error instanceof DOMException
                    ? error
                    : new DOMException(error instanceof Error ? error.message : String(error), 'AbortError')
            );
        }
    }

    function processNextOpen(): void {
        const request = pendingOpenRequests[0];
        if (!request) {
            return;
        }
        if (request.requestedVersion < databaseVersion) {
            failOpen(
                request,
                new DOMException('The requested version is less than the existing database version.', 'VersionError')
            );
            return;
        }
        if (request.requestedVersion === databaseVersion) {
            finishOpen(request);
            return;
        }
        if (!request.versionChangeDispatched) {
            request.versionChangeDispatched = true;
            for (const connection of connections) {
                if (connection.isEstablished() && !connection.isClosed()) {
                    connection.onversionchange?.();
                }
            }
            scheduleOpenProcessing();
            return;
        }
        const blockers = connections.filter((connection) => connection.isEstablished() && !connection.isClosed());
        if (blockers.length > 0) {
            if (!request.blockedFired) {
                request.blockedFired = true;
                request.onblocked?.();
            }
            return;
        }
        performUpgrade(request);
    }

    function createConnection(version: number): FakeConnection {
        let closed = false;
        let established = false;
        const connection: FakeConnection = {
            objectStoreNames: { contains: (name: string) => existingStores.has(name) },
            createObjectStore: (name: string) => {
                if (existingStores.has(name)) {
                    throw new DOMException(
                        'An object store with the specified name already exists.',
                        'ConstraintError'
                    );
                }
                existingStores.add(name);
                return undefined;
            },
            onclose: null,
            onversionchange: null,
            close: () => {
                if (closed) {
                    return;
                }
                closed = true;
                closeCount++;
                scheduleOpenProcessing();
            },
            transaction: (storeNames: string | string[], mode: IDBTransactionMode = 'readonly') => {
                if (closed) {
                    // What a browser throws for a transaction on a closed
                    // connection. Reusing a handle after `close()` is a bug the
                    // double must surface, not absorb.
                    throw new DOMException(
                        'Failed to execute transaction on IDBDatabase: The database connection is closing.',
                        'InvalidStateError'
                    );
                }
                const scope = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
                for (const name of scope) {
                    if (!existingStores.has(name)) {
                        throw new DOMException(
                            `Failed to execute 'transaction' on 'IDBDatabase': One of the specified object stores was not found.`,
                            'NotFoundError'
                        );
                    }
                }
                transactionScopes.push(scope);
                const isWrite = mode === 'readwrite';
                if (isWrite) {
                    writeTransactionCount++;
                }
                const doomed =
                    isWrite &&
                    (abortWrites ||
                        abortNextWrite ||
                        (abortWritesToStore !== null && scope.includes(abortWritesToStore)));
                if (isWrite && abortNextWrite) {
                    abortNextWrite = false;
                }
                let heldSettlements: Array<() => void> | undefined;
                if (isWrite && pauseWriteSettlements) {
                    heldSettlements = pendingWriteSettlements;
                } else if (!isWrite && pauseReadonlySettlements) {
                    heldSettlements = pendingReadonlySettlements;
                }
                let scheduled: ScheduledTransaction;
                const transaction = new FakeTransaction(
                    tables,
                    scope,
                    doomed,
                    meters,
                    heldSettlements ? (settle) => heldSettlements.push(settle) : undefined,
                    () => finishTransaction(scheduled),
                    (storeName) => failingRequestStore === storeName
                );
                scheduled = scheduleTransaction(transaction, scope, mode);
                return transaction;
            },
            version,
            isClosed: () => closed,
            isEstablished: () => established,
            markEstablished: () => {
                established = true;
            },
        };
        return connection;
    }

    function latestConnection(): FakeConnection {
        const connection = connections.at(-1);
        if (!connection) {
            throw new Error('fakeAudioBufferIndexedDb: no connection has been opened yet');
        }
        return connection;
    }

    vi.stubGlobal('indexedDB', {
        open: (_name: string, requestedVersion?: number) => {
            openRequestCount++;
            const version = requestedVersion ?? databaseVersion;
            const connection = createConnection(version);
            connections.push(connection);
            const request: FakeOpenRequest = {
                result: connection,
                error: null,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onupgradeneeded: null as (() => void) | null,
                onblocked: null as (() => void) | null,
                requestedVersion: version,
                versionChangeDispatched: false,
                blockedFired: false,
            };
            if (input.blockOpens !== undefined) {
                setTimeout(() => {
                    request.onblocked?.();
                    if (input.blockOpens === 'forever') {
                        return;
                    }
                    setTimeout(() => {
                        if (request.requestedVersion > databaseVersion) {
                            request.onupgradeneeded?.();
                            databaseVersion = request.requestedVersion;
                        }
                        request.result.markEstablished();
                        request.onsuccess?.();
                    }, 0);
                }, 0);
                return request;
            }
            pendingOpenRequests.push(request);
            scheduleOpenProcessing();
            return request;
        },
    });

    return {
        committed,
        committedMeta,
        committedRecovery,
        storeNames: () => [...existingStores],
        abortWrites: () => {
            abortWrites = true;
        },
        abortWritesTo: (storeName: string) => {
            abortWritesToStore = storeName;
        },
        allowWrites: () => {
            abortWrites = false;
            abortWritesToStore = null;
        },
        abortNextWrite: () => {
            abortNextWrite = true;
        },
        failRequestsFrom: (storeName: string) => {
            failingRequestStore = storeName;
        },
        allowRequests: () => {
            failingRequestStore = null;
        },
        pauseReadonlySettlements: () => {
            pauseReadonlySettlements = true;
        },
        releaseNextReadonlySettlement: () => {
            pendingReadonlySettlements.shift()?.();
        },
        pendingReadonlySettlementCount: () => pendingReadonlySettlements.length,
        pauseWriteSettlements: () => {
            pauseWriteSettlements = true;
        },
        releaseNextWriteSettlement: () => {
            pendingWriteSettlements.shift()?.();
        },
        pendingWriteSettlementCount: () => pendingWriteSettlements.length,
        writeTransactionCount: () => writeTransactionCount,
        openRequestCount: () => openRequestCount,
        closeCount: () => closeCount,
        liveConnectionCount: () => connections.filter((connection) => !connection.isClosed()).length,
        bytesRead: () => meters.read,
        bytesWritten: () => meters.written,
        resetByteCounters: () => {
            meters.read = 0;
            meters.written = 0;
        },
        transactionScopes: () => transactionScopes.map((scope) => [...scope]),
        fireVersionChange: () => {
            latestConnection().onversionchange?.();
        },
        fireAbnormalClose: () => {
            const connection = latestConnection();
            // The browser has already torn the connection down when `close`
            // fires, so the handle is dead before the handler runs.
            connection.close();
            closeCount--;
            connection.onclose?.();
        },
    };
}

/** Let every queued task (and the microtasks each one unblocks) run. */
export async function flushIndexedDbTasks(rounds = 40): Promise<void> {
    for (let round = 0; round < rounds; round++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
}

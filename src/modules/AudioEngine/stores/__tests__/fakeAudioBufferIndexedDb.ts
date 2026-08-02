import { vi } from 'vitest';

/**
 * Controllable IndexedDB double for the audio-buffer cache specs.
 *
 * Faithful on the three points these specs turn on:
 *
 * 1. Request events are delivered as **tasks**, not microtasks (IDB 3.0 §5.6).
 *    A caller that resolves without waiting for its request therefore resolves
 *    strictly before the request has produced anything — the ordering the
 *    unobserved-write defects rest on.
 * 2. Writes are staged and become visible only when the transaction commits, so
 *    "the write landed" and "the request succeeded" are distinguishable.
 * 3. A transaction can abort **bare** — firing `abort` and no `error` — which is
 *    what leaves an `onabort`-less promise pending forever.
 */

export type StoredAudioBuffer = {
    sampleRate: number;
    numberOfChannels: number;
    channelData: Float32Array[];
    lastAccessed: number;
    sizeInBytes: number;
};

type FakeRequest<T> = {
    result: T | undefined;
    error: unknown;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
};

export type FakeAudioIndexedDbControls = {
    /** Committed contents of the object store. */
    committed: Map<string, StoredAudioBuffer>;
    /** Abort every subsequent readwrite transaction, after its requests succeed. */
    abortWrites: () => void;
    /** Number of readwrite transactions opened against the database. */
    writeTransactionCount: () => number;
};

class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    error: unknown = null;

    private readonly queue: Array<() => void> = [];
    private scheduled = false;
    private settled = false;

    constructor(
        private readonly committed: Map<string, StoredAudioBuffer>,
        private readonly staged: Map<string, StoredAudioBuffer | null>,
        private readonly willAbort: boolean
    ) {
        this.schedule();
    }

    enqueue(operation: () => void): void {
        this.queue.push(operation);
        this.schedule();
    }

    objectStore(): FakeObjectStore {
        return new FakeObjectStore(this, this.committed, this.staged);
    }

    abort(): void {
        this.settle(true);
    }

    private schedule(): void {
        if (this.scheduled || this.settled) {
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
            operation();
            // A handler may have queued further requests on this transaction;
            // real IDB keeps the transaction alive while that happens.
            this.schedule();
            return;
        }
        this.settle(this.willAbort);
    }

    private settle(abort: boolean): void {
        if (this.settled) {
            return;
        }
        this.settled = true;
        if (abort) {
            this.staged.clear();
            this.error = null;
            // A bare abort fires `abort` and nothing else.
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
        private readonly committed: Map<string, StoredAudioBuffer>,
        private readonly staged: Map<string, StoredAudioBuffer | null>
    ) {}

    get(key: string): FakeRequest<StoredAudioBuffer | undefined> {
        return this.request(() => this.read(key) ?? undefined);
    }

    getAll(): FakeRequest<StoredAudioBuffer[]> {
        return this.request(() => [...this.keys()].map((key) => this.read(key)!));
    }

    getAllKeys(): FakeRequest<string[]> {
        return this.request(() => [...this.keys()]);
    }

    put(value: StoredAudioBuffer, key: string): FakeRequest<undefined> {
        // IDB structured-clones the value at `put` time, so a later mutation of
        // the caller's object cannot reach the store.
        const snapshot = structuredClone(value);
        return this.request(() => {
            this.staged.set(key, snapshot);
            return undefined;
        });
    }

    delete(key: string): FakeRequest<undefined> {
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

    private keys(): string[] {
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

    private read(key: string): StoredAudioBuffer | null {
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
        this.transaction.enqueue(() => {
            request.result = run();
            request.onsuccess?.();
        });
        return request;
    }
}

export function installFakeAudioIndexedDb(): FakeAudioIndexedDbControls {
    const committed = new Map<string, StoredAudioBuffer>();
    let abortWrites = false;
    let writeTransactionCount = 0;

    const database = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => undefined,
        close: () => undefined,
        transaction: (_storeName: string, mode: IDBTransactionMode = 'readonly') => {
            const isWrite = mode === 'readwrite';
            if (isWrite) {
                writeTransactionCount++;
            }
            return new FakeTransaction(committed, new Map<string, StoredAudioBuffer | null>(), isWrite && abortWrites);
        },
    };

    vi.stubGlobal('indexedDB', {
        open: () => {
            const request = {
                result: database,
                error: null,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
                onupgradeneeded: null as (() => void) | null,
            };
            setTimeout(() => {
                request.onupgradeneeded?.();
                request.onsuccess?.();
            }, 0);
            return request;
        },
    });

    return {
        committed,
        abortWrites: () => {
            abortWrites = true;
        },
        writeTransactionCount: () => writeTransactionCount,
    };
}

/** Let every queued task (and the microtasks each one unblocks) run. */
export async function flushIndexedDbTasks(rounds = 40): Promise<void> {
    for (let round = 0; round < rounds; round++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
}

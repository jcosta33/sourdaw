/**
 * Shared IndexedDB state for project storage operations.
 *
 * Public repository operations live in separate files; this module keeps
 * their cache, connection, constants, and low-level storage helpers shared.
 *
 * Durability contract (ADR 0013): every write resolves on
 * `transaction.oncomplete` and rejects on `onerror`/`onabort`. An IndexedDB
 * request's `success` event fires before the transaction commits and is not a
 * durability signal (IDB 3.0 §5.6, §2.7.1), so no write path may resolve on it.
 * Writes await the database handle rather than null-checking it — a write
 * issued during the page-load window is queued behind the open, never dropped —
 * and reject outright when the database cannot be opened at all.
 */

const DB_NAME = 'sourdaw-projects';
const STORE_NAME = 'projects';
const DB_VERSION = 1;
const PRIMARY_KEY = 'current';
const LEGACY_PROJECT_STORAGE_KEY = 'sourdaw-project';

// In-memory cache for synchronous reads. Populated from IndexedDB on
// init or from in-process writes. Independent of the IDB connection — the
// cache may be set before or after the DB is open and can serve reads even if
// IDB is unavailable on this platform.
let cachedJson: string | null = null;

// The single in-flight-or-settled open. A rejected open is discarded so a later
// attempt can retry rather than inheriting a permanent failure.
let databasePromise: Promise<IDBDatabase> | null = null;

// The single in-flight-or-settled cache warm.
let initPromise: Promise<void> | null = null;

function createUnavailableError(cause: unknown): Error {
    const normalizedCause = cause ?? new Error('IndexedDB open request failed without an error cause');
    return new Error('Project storage is unavailable: IndexedDB could not be opened', { cause: normalizedCause });
}

function openDatabase(): Promise<IDBDatabase> {
    if (databasePromise) {
        return databasePromise;
    }

    const promise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof globalThis.indexedDB === 'undefined') {
            reject(createUnavailableError(new Error('This environment has no IndexedDB')));
            return;
        }

        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (error) {
            reject(createUnavailableError(error));
            return;
        }

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(createUnavailableError(request.error));
    });

    databasePromise = promise;
    promise.catch(() => {
        if (databasePromise === promise) {
            databasePromise = null;
        }
    });

    return promise;
}

async function runTransaction<Result>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => () => Result
): Promise<Result> {
    const database = await openDatabase();

    return new Promise<Result>((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, mode);
        const readResult = run(tx.objectStore(STORE_NAME));

        // Resolve on commit, never on request success — see the module docstring.
        tx.oncomplete = () => resolve(readResult());
        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
    });
}

async function idbGet(key: string): Promise<string | null> {
    try {
        return await runTransaction<string | null>('readonly', (store) => {
            const request = store.get(key);
            return () => (request.result as string | undefined) ?? null;
        });
    } catch {
        // A read cannot distinguish "absent" from "unreadable" for its callers,
        // and every caller already treats null as absent. Writes do not get this
        // treatment: they reject.
        return null;
    }
}

function idbPut(key: string, value: string): Promise<void> {
    return runTransaction<void>('readwrite', (store) => {
        store.put(value, key);
        return () => undefined;
    });
}

function idbDelete(key: string): Promise<void> {
    return runTransaction<void>('readwrite', (store) => {
        store.delete(key);
        return () => undefined;
    });
}

async function warmCache(): Promise<void> {
    const stored = await idbGet(PRIMARY_KEY);
    if (stored && !cachedJson) {
        cachedJson = stored;
    }
}

function initDB(): Promise<void> {
    if (!initPromise) {
        initPromise = warmCache();
    }
    return initPromise;
}

function getCachedJson(): string | null {
    return cachedJson;
}

function setCachedJson(value: string | null): void {
    cachedJson = value;
}

const storageSupport = {
    deleteIndexedDb: idbDelete,
    getCachedJson,
    getIndexedDb: idbGet,
    initializeIndexedDb: initDB,
    legacyProjectStorageKey: LEGACY_PROJECT_STORAGE_KEY,
    primaryKey: PRIMARY_KEY,
    putIndexedDb: idbPut,
    setCachedJson,
};

// Bootstrap — start loading IndexedDB immediately. initDB swallows an
// unavailable database because warming a read cache is best-effort; writes
// issued later still reject rather than no-op.
void initDB();

export { storageSupport };

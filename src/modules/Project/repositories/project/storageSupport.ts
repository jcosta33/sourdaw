/**
 * Shared IndexedDB state for project storage operations.
 *
 * Public repository operations live in separate files; this module keeps
 * their cache, connection, constants, and low-level storage helpers shared.
 */

const DB_NAME = 'sourdaw-projects';
const STORE_NAME = 'projects';
const DB_VERSION = 1;
const PRIMARY_KEY = 'current';
const LEGACY_PROJECT_STORAGE_KEY = 'sourdaw-project';

// In-memory cache for synchronous reads. Populated from IndexedDB on
// init, from localStorage during legacy migration, or from in-process
// writes. Independent of the IDB connection — the cache may be set
// before or after the DB is open and can serve reads even if IDB is
// unavailable on this platform.
let cachedJson: string | null = null;

// IndexedDB connection. `null` means the connection has not been
// opened yet OR the open attempt failed (e.g. private browsing); the
// idbGet/idbPut/idbDelete helpers all guard on this and become no-ops
// when it's null. There is no separate "ready" flag — `db !== null`
// already carries that information, and a separate flag was a
// footgun waiting to drift out of sync with the actual handle.
let db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}

async function initDB(): Promise<void> {
    if (db !== null) {
        return;
    }
    try {
        db = await openDB();

        // Load current project into cache
        const stored = await idbGet(PRIMARY_KEY);
        if (stored && !cachedJson) {
            cachedJson = stored;
        }
    } catch {
        // IndexedDB not available — fall back to localStorage only
    }
}

function idbGet(key: string): Promise<string | null> {
    return new Promise((resolve) => {
        if (!db) {
            resolve(null);
            return;
        }
        try {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve((req.result as string) ?? null);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

function idbPut(key: string, value: string): void {
    if (!db) {
        return;
    }
    try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(value, key);
    } catch {
        // IndexedDB write failed silently
    }
}

function idbDelete(key: string): void {
    if (!db) {
        return;
    }
    try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(key);
    } catch {
        // IndexedDB delete failed silently
    }
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

// Bootstrap — start loading IndexedDB immediately
void initDB();

export { storageSupport };

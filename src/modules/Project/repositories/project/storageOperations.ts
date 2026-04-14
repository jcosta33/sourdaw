/**
 * Project storage — IndexedDB primary, localStorage fallback.
 *
 * IndexedDB provides hundreds of MB (vs localStorage's 5-10MB),
 * which is essential for large projects with many tracks and MIDI data.
 *
 * Reads are synchronous from an in-memory cache.
 * Writes go to both IndexedDB (async) and the cache (sync).
 */

const DB_NAME = 'sourdaw-projects';
const STORE_NAME = 'projects';
const DB_VERSION = 1;
const PRIMARY_KEY = 'current';

// In-memory cache for synchronous reads. Populated from IndexedDB on
// init, from localStorage during legacy migration, or from in-process
// writes. Independent of the IDB connection — the cache may be set
// before or after the DB is open and can serve reads even if IDB is
// unavailable on this platform.
let cachedJson: string | null = null;

// IndexedDB connection. \`null\` means the connection has not been
// opened yet OR the open attempt failed (e.g. private browsing); the
// idbGet/idbPut/idbDelete helpers all guard on this and become no-ops
// when it's null. There is no separate "ready" flag — \`db !== null\`
// already carries that information, and a separate flag was a
// footgun waiting to drift out of sync with the actual handle.
let db: IDBDatabase | null = null;

// ── IndexedDB setup ──────────────────────────────────────────────────────

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
        request.onerror = () => reject(request.error);
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

// Bootstrap — start loading IndexedDB immediately
void initDB();

// ── Public API (same interface as before) ────────────────────────────────

export function readProjectJson(): string | null {
    // Sync read from cache (populated from IndexedDB on init, or from writes)
    if (cachedJson) {
        return cachedJson;
    }

    // Fallback: try localStorage for migration from old storage
    try {
        const legacy = localStorage.getItem('sourdaw-project');
        if (legacy) {
            cachedJson = legacy;
            // Migrate to IndexedDB
            idbPut(PRIMARY_KEY, legacy);
            return legacy;
        }
    } catch {
        // localStorage not available
    }

    return null;
}

export function writeProjectJson(json: string): void {
    // Update cache synchronously
    cachedJson = json;

    // Write to IndexedDB (async, no size limit)
    idbPut(PRIMARY_KEY, json);

    // Also try localStorage as a fallback (may fail for large projects)
    try {
        localStorage.setItem('sourdaw-project', json);
    } catch {
        // Quota exceeded — IndexedDB has it, so this is fine
    }
}

export function removeProjectJson(): void {
    cachedJson = null;
    idbDelete(PRIMARY_KEY);
    try {
        localStorage.removeItem('sourdaw-project');
    } catch {
        // Ignore
    }
}

export function writeNamedProjectJson(name: string, json: string): void {
    const key = `sourdaw:project:${name}`;
    idbPut(key, json);
    try {
        localStorage.setItem(key, json);
    } catch {
        // Quota exceeded — IndexedDB has it
    }
}

export function readNamedProjectJson(key: string): string | null {
    // For named projects, try localStorage first (sync), then IndexedDB would need async
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

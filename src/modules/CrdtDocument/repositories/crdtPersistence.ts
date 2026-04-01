import { type DocId, type DocumentBundle } from '../models/CrdtDocumentTypes';

const DB_NAME = 'sourdaw-crdt-docs';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDatabase = (): Promise<IDBDatabase | null> => {
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve) => {
        if (typeof globalThis.indexedDB === 'undefined') {
            resolve(null);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onerror = () => {
            console.error('[CrdtPersistence] Failed to open IndexedDB:', request.error);
            resolve(null);
        };
    });

    return dbPromise;
};

/** Save a single document to IndexedDB. */
export const saveDocToIdb = async (id: DocId, bytes: Uint8Array): Promise<void> => {
    const database = await openDatabase();
    if (!database) {
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(bytes, id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

/** Load a single document from IndexedDB. */
export const loadDocFromIdb = async (id: DocId): Promise<Uint8Array | null> => {
    const database = await openDatabase();
    if (!database) {
        return null;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => {
            const result = request.result as Uint8Array | undefined;
            resolve(result ?? null);
        };
        request.onerror = () => reject(request.error);
    });
};

/** Save all documents to IndexedDB. */
export const saveAllToIdb = async (bundle: DocumentBundle): Promise<void> => {
    const database = await openDatabase();
    if (!database) {
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // Clear existing docs first
        store.clear();

        // Write all documents
        for (const [id, bytes] of bundle) {
            store.put(bytes, id);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

/** Load all documents from IndexedDB. */
export const loadAllFromIdb = async (): Promise<DocumentBundle | null> => {
    const database = await openDatabase();
    if (!database) {
        return null;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        const keysRequest = store.getAllKeys();
        const valuesRequest = store.getAll();

        tx.oncomplete = () => {
            const keys = keysRequest.result;
            const values = valuesRequest.result as Uint8Array[];

            if (keys.length === 0) {
                resolve(null);
                return;
            }

            const bundle: DocumentBundle = new Map();
            for (let i = 0; i < keys.length; i++) {
                const value = values[i];
                if (value) {
                    bundle.set(String(keys[i]), value);
                }
            }
            resolve(bundle);
        };

        tx.onerror = () => reject(tx.error);
    });
};

/** Clear all stored CRDT documents. */
export const clearCrdtIdb = async (): Promise<void> => {
    const database = await openDatabase();
    if (!database) {
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

/** Save an incremental chunk for a document (append, don't replace). */
export const saveIncrementalToIdb = async (id: DocId, chunk: Uint8Array): Promise<void> => {
    if (chunk.length === 0) {
        return;
    }
    const database = await openDatabase();
    if (!database) {
        return;
    }

    const key = `${id}:incremental:${Date.now()}`;
    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(chunk, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

/** Load all incremental chunks for a document and apply them to the base. */
export const loadIncrementalsFromIdb = async (id: DocId): Promise<Uint8Array[]> => {
    const database = await openDatabase();
    if (!database) {
        return [];
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const prefix = `${id}:incremental:`;
        const chunks: Uint8Array[] = [];

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
                if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
                    chunks.push(cursor.value as Uint8Array);
                }
                cursor.continue();
            }
        };

        tx.oncomplete = () => resolve(chunks);
        tx.onerror = () => reject(tx.error);
    });
};

/** Remove all incremental chunks for a document (after compaction). */
export const clearIncrementalsFromIdb = async (id: DocId): Promise<void> => {
    const database = await openDatabase();
    if (!database) {
        return;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const prefix = `${id}:incremental:`;

        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
                if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
};

/** Check whether any CRDT documents exist in IndexedDB. */
export const hasCrdtDocsInIdb = async (): Promise<boolean> => {
    const database = await openDatabase();
    if (!database) {
        return false;
    }

    return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () => resolve(request.result > 0);
        request.onerror = () => reject(request.error);
    });
};

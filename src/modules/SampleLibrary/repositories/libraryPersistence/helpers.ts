export const DB_NAME = 'sourdaw-library';
export const DB_VERSION = 1;
export const ROOTS_STORE = 'roots';
export const SAMPLES_STORE = 'samples';
export const HANDLES_STORE = 'handles';

export function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(ROOTS_STORE)) {
                db.createObjectStore(ROOTS_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SAMPLES_STORE)) {
                db.createObjectStore(SAMPLES_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(HANDLES_STORE)) {
                db.createObjectStore(HANDLES_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
}

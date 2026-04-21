import { logger } from '#/infra/logger/appLogger';

export const DB_NAME = 'sourdaw-crdt-docs';
export const DB_VERSION = 1;
export const STORE_NAME = 'documents';
let _db: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase | null> | null = null;

export function getDb(): IDBDatabase | null {
    return _db;
}

export function getDbPromise(): Promise<IDBDatabase | null> | null {
    return _dbPromise;
}

export function openDatabase(): Promise<IDBDatabase | null> {
    if (_dbPromise) {
        return _dbPromise;
    }

    _dbPromise = new Promise((resolve) => {
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
            _db = request.result;
            resolve(_db);
        };

        request.onerror = () => {
            logger.warn('[CrdtPersistence] Failed to open IndexedDB:', request.error);
            resolve(null);
        };
    });

    return _dbPromise;
}

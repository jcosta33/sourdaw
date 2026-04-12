import { logger } from '#/infra/logger/appLogger';

export const DB_NAME = 'sourdaw-crdt-docs';
export const DB_VERSION = 1;
export const STORE_NAME = 'documents';
export let db: IDBDatabase | null = null;
export let dbPromise: Promise<IDBDatabase | null> | null = null;

export const openDatabase = (): Promise<IDBDatabase | null> => {
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
            logger.warn('[CrdtPersistence] Failed to open IndexedDB:', request.error);
            resolve(null);
        };
    });

    return dbPromise;
};
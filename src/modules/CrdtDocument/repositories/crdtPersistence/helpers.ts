import { logger } from '#/infra/logger/appLogger';

export const DB_NAME = 'sourdaw-crdt-docs';
export const DB_VERSION = 1;
export const STORE_NAME = 'documents';
let _db: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase | null> | null = null;
let _dbGeneration = 0;

function invalidateDatabase(generation: number): void {
    if (_dbGeneration !== generation) {
        return;
    }

    _db = null;
    _dbPromise = null;
    _dbGeneration++;
}

export function openDatabase(): Promise<IDBDatabase | null> {
    if (_dbPromise) {
        return _dbPromise;
    }

    const generation = ++_dbGeneration;
    const promise = new Promise<IDBDatabase | null>((resolve) => {
        if (typeof globalThis.indexedDB === 'undefined') {
            queueMicrotask(() => invalidateDatabase(generation));
            resolve(null);
            return;
        }

        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (error) {
            logger.warn('[CrdtPersistence] Failed to open IndexedDB:', error);
            queueMicrotask(() => invalidateDatabase(generation));
            resolve(null);
            return;
        }

        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };

        request.onblocked = () => {
            logger.warn('[CrdtPersistence] IndexedDB open is blocked by another connection.');
        };

        request.onsuccess = () => {
            const database = request.result;
            if (_dbGeneration !== generation) {
                database.close();
                resolve(null);
                return;
            }

            _db = database;
            database.onversionchange = () => {
                const isCurrentDatabase = _db === database && _dbGeneration === generation;
                database.close();
                if (isCurrentDatabase) {
                    invalidateDatabase(generation);
                }
            };
            resolve(database);
        };

        request.onerror = () => {
            logger.warn('[CrdtPersistence] Failed to open IndexedDB:', request.error);
            invalidateDatabase(generation);
            resolve(null);
        };
    });

    _dbPromise = promise;
    return promise;
}

import { logger } from '#/infra/logger/appLogger';

export const DB_NAME = 'sourdaw-crdt-docs';
export const DB_VERSION = 2;
export const STORE_NAME = 'documents';
export const CHECKPOINT_ARTIFACT_STORE_NAME = 'checkpoint-artifacts';
export const CHECKPOINT_CATALOG_STORE_NAME = 'checkpoint-catalog';
let _db: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase | null> | null = null;
let _dbGeneration = 0;

function createDatabaseOpenError(cause: unknown): Error {
    const normalizedCause = cause ?? new Error('IndexedDB open request failed without an error cause');
    return new Error('[CrdtPersistence] Failed to open IndexedDB', { cause: normalizedCause });
}

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
    let resolveOpen!: (database: IDBDatabase | null) => void;
    let rejectOpen!: (reason?: unknown) => void;
    const promise = new Promise<IDBDatabase | null>((resolve, reject) => {
        resolveOpen = resolve;
        rejectOpen = reject;
    });
    _dbPromise = promise;

    if (typeof globalThis.indexedDB === 'undefined') {
        queueMicrotask(() => invalidateDatabase(generation));
        resolveOpen(null);
        return promise;
    }

    let request: IDBOpenDBRequest;
    try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
        const openError = createDatabaseOpenError(error);
        logger.warn('[CrdtPersistence] Failed to open IndexedDB:', error);
        queueMicrotask(() => invalidateDatabase(generation));
        rejectOpen(openError);
        return promise;
    }

    request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME);
        }
        if (!database.objectStoreNames.contains(CHECKPOINT_ARTIFACT_STORE_NAME)) {
            database.createObjectStore(CHECKPOINT_ARTIFACT_STORE_NAME);
        }
        if (!database.objectStoreNames.contains(CHECKPOINT_CATALOG_STORE_NAME)) {
            database.createObjectStore(CHECKPOINT_CATALOG_STORE_NAME);
        }
    };

    request.onblocked = () => {
        logger.warn('[CrdtPersistence] IndexedDB open is blocked by another connection.');
    };

    request.onsuccess = () => {
        const database = request.result;
        if (_dbGeneration !== generation) {
            database.close();
            resolveOpen(null);
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
        resolveOpen(database);
    };

    request.onerror = () => {
        const openError = createDatabaseOpenError(request.error);
        logger.warn('[CrdtPersistence] Failed to open IndexedDB:', request.error);
        invalidateDatabase(generation);
        rejectOpen(openError);
    };

    return promise;
}

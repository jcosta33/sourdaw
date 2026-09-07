import { describe, expect, it } from 'vitest';

import { installTransactionalIndexedDb } from '../installTransactionalIndexedDb';

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('fixture', 2);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('documents')) {
                request.result.createObjectStore('documents');
            }
        };
        request.onsuccess = () => resolve(request.result);
    });
}

async function completeLatestWrite(installation: ReturnType<typeof installTransactionalIndexedDb>): Promise<void> {
    const transaction = installation.persistence.getTransactions('readwrite').at(-1);
    if (!transaction) {
        throw new Error('Expected a write transaction');
    }
    const completed = new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
    });
    transaction.complete();
    await completed;
}

describe('installTransactionalIndexedDb', () => {
    it('drives the IndexedDB open lifecycle and commits isolated byte records', async () => {
        const installation = installTransactionalIndexedDb();
        try {
            const database = await openDatabase();
            expect(database.objectStoreNames.contains('documents')).toBe(true);

            const transaction = database.transaction('documents', 'readwrite');
            transaction.objectStore('documents').put(new Uint8Array([1, 2, 3]), 'root');
            await new Promise<void>((resolve) => {
                transaction.oncomplete = () => resolve();
            });

            expect(installation.persistence.records.get('root')).toEqual(new Uint8Array([1, 2, 3]));
        } finally {
            await installation.dispose();
        }
    });

    it('keeps explicit completion available when automatic completion is disabled', async () => {
        const installation = installTransactionalIndexedDb({ autoCompleteReadwrite: false });
        try {
            const database = await openDatabase();
            const transaction = database.transaction('documents', 'readwrite');
            transaction.objectStore('documents').put(new Uint8Array([4]), 'root');
            expect(installation.persistence.records.has('root')).toBe(false);

            await completeLatestWrite(installation);
            expect(installation.persistence.records.get('root')).toEqual(new Uint8Array([4]));
        } finally {
            await installation.dispose();
        }
    });

    it('restores the global and invalidates the connection when disposal rejects for an unsettled write', async () => {
        const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        const originalIndexedDb = globalThis.indexedDB;
        const installation = installTransactionalIndexedDb({ autoCompleteReadwrite: false });
        const installedIndexedDb = globalThis.indexedDB;
        let database: IDBDatabase | null = null;
        let connectionInvalidated = false;
        let connectionClosed = false;

        try {
            database = await openDatabase();
            const originalClose = database.close.bind(database);
            database.close = () => {
                connectionClosed = true;
                originalClose();
            };
            database.onversionchange = () => {
                connectionInvalidated = true;
                database?.close();
            };
            database
                .transaction('documents', 'readwrite')
                .objectStore('documents')
                .put(new Uint8Array([5]), 'root');

            await expect(installation.dispose()).rejects.toThrow(
                'Transactional IndexedDB still has unsettled transactions during cleanup'
            );
            expect.soft(globalThis.indexedDB).toBe(originalIndexedDb);
            expect.soft(globalThis.indexedDB).not.toBe(installedIndexedDb);
            expect.soft(connectionInvalidated).toBe(true);
            expect.soft(connectionClosed).toBe(true);
        } finally {
            database?.onversionchange?.();
            if (originalIndexedDbDescriptor) {
                Object.defineProperty(globalThis, 'indexedDB', originalIndexedDbDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'indexedDB');
            }
        }
    });

    it('does not allow an open request to cache a connection after disposal has finished', async () => {
        const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        const originalIndexedDb = globalThis.indexedDB;
        const installation = installTransactionalIndexedDb();
        const events: string[] = [];
        let cachedDatabase: IDBDatabase | null = null;
        let connectionInvalidated = false;
        let connectionClosed = false;

        try {
            const request = indexedDB.open('fixture', 2);
            request.onupgradeneeded = () => {
                events.push('upgrade');
                if (!request.result.objectStoreNames.contains('documents')) {
                    request.result.createObjectStore('documents');
                }
            };
            request.onsuccess = () => {
                events.push('success');
                cachedDatabase = request.result;
                const originalClose = request.result.close.bind(request.result);
                request.result.close = () => {
                    connectionClosed = true;
                    originalClose();
                };
                request.result.onversionchange = () => {
                    connectionInvalidated = true;
                    request.result.close();
                };
            };
            events.push('open');

            await installation.dispose();
            events.push('disposed');
            await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)));

            expect.soft(events).toEqual(['open', 'disposed']);
            expect.soft(globalThis.indexedDB).toBe(originalIndexedDb);
            expect.soft(cachedDatabase).toBeNull();
            expect.soft(connectionInvalidated).toBe(false);
            expect.soft(connectionClosed).toBe(false);
        } finally {
            cachedDatabase?.onversionchange?.();
            if (originalIndexedDbDescriptor) {
                Object.defineProperty(globalThis, 'indexedDB', originalIndexedDbDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'indexedDB');
            }
        }
    });

    it('isolates successive installations and restores the original global after each one closes', async () => {
        const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        const originalIndexedDb = globalThis.indexedDB;
        const first = installTransactionalIndexedDb({ autoCompleteReadwrite: false });
        let second: ReturnType<typeof installTransactionalIndexedDb> | null = null;

        try {
            const firstDatabase = await openDatabase();
            firstDatabase
                .transaction('documents', 'readwrite')
                .objectStore('documents')
                .put(new Uint8Array([6]), 'root');
            await completeLatestWrite(first);
            await first.dispose();

            second = installTransactionalIndexedDb({ autoCompleteReadwrite: false });
            const secondDatabase = await openDatabase();
            secondDatabase
                .transaction('documents', 'readwrite')
                .objectStore('documents')
                .put(new Uint8Array([7]), 'root');
            await completeLatestWrite(second);

            expect(first.persistence.records.get('root')).toEqual(new Uint8Array([6]));
            expect(second.persistence.records.get('root')).toEqual(new Uint8Array([7]));
            expect(globalThis.indexedDB).not.toBe(originalIndexedDb);

            await second.dispose();
            second = null;
            expect(globalThis.indexedDB).toBe(originalIndexedDb);
        } finally {
            await second?.dispose();
            if (originalIndexedDbDescriptor) {
                Object.defineProperty(globalThis, 'indexedDB', originalIndexedDbDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, 'indexedDB');
            }
        }
    });
});

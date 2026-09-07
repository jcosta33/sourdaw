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

            const completed = new Promise<void>((resolve) => {
                transaction.oncomplete = () => resolve();
            });
            (transaction as unknown as { complete: () => void }).complete();
            await completed;
            expect(installation.persistence.records.get('root')).toEqual(new Uint8Array([4]));
        } finally {
            await installation.dispose();
        }
    });
});

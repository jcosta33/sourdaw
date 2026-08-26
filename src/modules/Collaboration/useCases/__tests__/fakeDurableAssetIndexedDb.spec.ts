import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeDurableAssetIndexedDb } from './fakeDurableAssetIndexedDb';

function waitForOpen(request: IDBOpenDBRequest): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('open failed'));
    });
}

function waitForTransaction(transaction: IDBTransaction): Promise<'complete' | 'aborted'> {
    return new Promise((resolve) => {
        transaction.oncomplete = () => resolve('complete');
        transaction.onabort = () => resolve('aborted');
    });
}

describe('fake durable asset IndexedDB fidelity', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('serializes overlapping readwrite scopes so one abort cannot erase a later commit', async () => {
        const fake = installFakeDurableAssetIndexedDb();
        const opening = indexedDB.open('serialized-writes', 1);
        opening.onupgradeneeded = () => {
            opening.result.createObjectStore('assets', { keyPath: 'hash' });
        };
        const database = await waitForOpen(opening);
        fake.failNextReadwriteTransactions(1);

        const first = database.transaction('assets', 'readwrite');
        const firstDone = waitForTransaction(first);
        first.objectStore('assets').put({ hash: 'first', value: 1 });
        const second = database.transaction('assets', 'readwrite');
        const secondDone = waitForTransaction(second);
        second.objectStore('assets').put({ hash: 'second', value: 2 });

        await expect(firstDone).resolves.toBe('aborted');
        await expect(secondDone).resolves.toBe('complete');
        const verify = database.transaction('assets', 'readonly');
        const secondRecord = verify.objectStore('assets').get('second');
        const value = await new Promise<unknown>((resolve, reject) => {
            secondRecord.onsuccess = () => resolve(secondRecord.result);
            secondRecord.onerror = () => reject(secondRecord.error);
        });
        expect(value).toEqual({ hash: 'second', value: 2 });
    });

    it('rolls back a failed schema upgrade atomically and retries from the prior version', async () => {
        installFakeDurableAssetIndexedDb();
        const failedUpgrade = indexedDB.open('atomic-upgrade', 1);
        let unexpectedlySucceeded = false;
        failedUpgrade.onupgradeneeded = () => {
            failedUpgrade.result.createObjectStore('partial', { keyPath: 'id' });
            failedUpgrade.transaction!.abort();
        };
        failedUpgrade.onsuccess = () => {
            unexpectedlySucceeded = true;
        };
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(unexpectedlySucceeded).toBe(false);

        const retry = indexedDB.open('atomic-upgrade', 1);
        let retryOldVersion: number | undefined;
        let retainedPartialStore = false;
        retry.onupgradeneeded = (event) => {
            retryOldVersion = event.oldVersion;
            retainedPartialStore = retry.result.objectStoreNames.contains('partial');
            retry.result.createObjectStore('complete', { keyPath: 'id' });
        };
        await waitForOpen(retry);

        expect(retryOldVersion).toBe(0);
        expect(retainedPartialStore).toBe(false);

        const nextUpgrade = indexedDB.open('atomic-upgrade', 2);
        let nextOldVersion: number | undefined;
        nextUpgrade.onupgradeneeded = (event) => {
            nextOldVersion = event.oldVersion;
            nextUpgrade.result.createObjectStore('later', { keyPath: 'id' });
        };
        await waitForOpen(nextUpgrade);
        expect(nextOldVersion).toBe(1);
    });
});

import { describe, expect, it } from 'vitest';

import {
    BUFFER_STORE,
    flushIndexedDbTasks,
    installFakeAudioIndexedDb,
    META_STORE,
    RECOVERY_STORE,
} from './fakeAudioBufferIndexedDb';

function openDatabase(
    version = 2,
    onUpgrade?: (database: IDBDatabase) => void,
    onBlocked?: () => void
): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('sourdaw-audio', version);
        request.onupgradeneeded = () => onUpgrade?.(request.result);
        request.onblocked = () => onBlocked?.();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
}

function transactionSettled(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    });
}

describe('fakeAudioBufferIndexedDb', () => {
    it('serializes concurrent upgrades behind versionchange and upgrades a version only once', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE] });
        const blocker = await openDatabase(2);
        let versionChangeCount = 0;
        blocker.onversionchange = () => {
            versionChangeCount++;
        };
        let upgradeCount = 0;
        let blockedCount = 0;
        let firstSettled = false;
        let secondSettled = false;
        const first = openDatabase(
            3,
            (database) => {
                upgradeCount++;
                database.createObjectStore(RECOVERY_STORE);
            },
            () => {
                blockedCount++;
            }
        ).then((database) => {
            firstSettled = true;
            return database;
        });
        const second = openDatabase(3, () => {
            upgradeCount++;
        }).then((database) => {
            secondSettled = true;
            return database;
        });

        await flushIndexedDbTasks(4);
        expect(versionChangeCount).toBe(1);
        expect(blockedCount).toBe(1);
        expect(firstSettled).toBe(false);
        expect(secondSettled).toBe(false);

        blocker.close();
        const [firstConnection, secondConnection] = await Promise.all([first, second]);
        expect(upgradeCount).toBe(1);
        expect(firstConnection.version).toBe(3);
        expect(secondConnection.version).toBe(3);
        expect(controls.storeNames()).toContain(RECOVERY_STORE);
    });

    it('serializes overlapping readwrite transactions before the later transaction reads', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE] });
        controls.pauseWriteSettlements();
        const database = await openDatabase();
        const first = database.transaction([BUFFER_STORE, META_STORE], 'readwrite');
        first.objectStore(BUFFER_STORE).put(
            {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.25])],
                lastAccessed: 1,
                sizeInBytes: 4,
            },
            'serialized'
        );
        const firstSettled = transactionSettled(first);
        while (controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }

        let secondReadSettled = false;
        const second = database.transaction([BUFFER_STORE, META_STORE], 'readwrite');
        const secondRead = second.objectStore(BUFFER_STORE).get('serialized');
        secondRead.onsuccess = () => {
            secondReadSettled = true;
        };
        const secondSettled = transactionSettled(second);
        await flushIndexedDbTasks(4);

        expect(secondReadSettled).toBe(false);
        expect(controls.pendingWriteSettlementCount()).toBe(1);
        controls.releaseNextWriteSettlement();
        await firstSettled;
        while (!secondReadSettled || controls.pendingWriteSettlementCount() === 0) {
            await flushIndexedDbTasks(1);
        }
        controls.releaseNextWriteSettlement();
        await secondSettled;
        expect((secondRead.result as { channelData: Float32Array[] }).channelData[0]?.[0]).toBeCloseTo(0.25);
    });

    it('aborts and rolls back the whole transaction after an unprevented request error', async () => {
        const controls = installFakeAudioIndexedDb({ existingStores: [BUFFER_STORE, META_STORE] });
        const database = await openDatabase();
        controls.failRequestsFrom(META_STORE);
        const transaction = database.transaction([BUFFER_STORE, META_STORE], 'readwrite');
        transaction.objectStore(BUFFER_STORE).put(
            {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.5])],
                lastAccessed: 1,
                sizeInBytes: 4,
            },
            'first'
        );
        transaction.objectStore(META_STORE).put({ lastAccessed: 1, sizeInBytes: 4 }, 'first');
        transaction.objectStore(BUFFER_STORE).put(
            {
                sampleRate: 48_000,
                numberOfChannels: 1,
                channelData: [new Float32Array([0.75])],
                lastAccessed: 1,
                sizeInBytes: 4,
            },
            'second'
        );

        await expect(transactionSettled(transaction)).rejects.toThrow('The request failed.');
        expect(controls.committed.size).toBe(0);
        expect(controls.committedMeta.size).toBe(0);
    });
});

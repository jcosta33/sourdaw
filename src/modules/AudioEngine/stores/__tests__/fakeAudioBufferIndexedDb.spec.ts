import { describe, expect, it } from 'vitest';

import { BUFFER_STORE, flushIndexedDbTasks, installFakeAudioIndexedDb, META_STORE } from './fakeAudioBufferIndexedDb';

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('sourdaw-audio', 2);
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
});

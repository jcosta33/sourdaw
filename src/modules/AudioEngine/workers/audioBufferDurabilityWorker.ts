/// <reference lib="webworker" />

import {
    AUDIO_BUFFER_DATABASE_NAME,
    AUDIO_BUFFER_DATABASE_VERSION,
    AUDIO_BUFFER_METADATA_STORE,
    AUDIO_BUFFER_PCM_STORE,
} from '../models/AudioBufferStorageSchema';
import { readDurableAudioBufferRevision } from '../transformers/audioBufferPersistenceIdentity';

import type { AudioBufferDurabilityResponse } from '../models/AudioBufferDurabilityMessage';

function readRequestIds(data: unknown): string[] | undefined {
    if (data === null || typeof data !== 'object' || !('ids' in data) || !Array.isArray(data.ids)) {
        return undefined;
    }
    const ids: string[] = [];
    const values: unknown[] = data.ids;
    for (const value of values) {
        if (typeof value !== 'string') {
            return undefined;
        }
        ids.push(value);
    }
    return ids;
}

function openExistingDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        // The cache owns schema creation and migration. This read cannot create a database.
        const request = indexedDB.open(AUDIO_BUFFER_DATABASE_NAME);
        let blocked = false;
        request.onblocked = () => {
            blocked = true;
            reject(new Error('Audio durability worker database open was blocked'));
        };
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => reject(request.error ?? new Error('Audio durability worker IndexedDB request failed'));
        request.onsuccess = () => {
            const database = request.result;
            if (blocked || database.version !== AUDIO_BUFFER_DATABASE_VERSION) {
                database.close();
                reject(new Error('Audio durability worker database schema changed'));
                return;
            }
            database.onversionchange = () => database.close();
            resolve(database);
        };
    });
}

function readRecord(store: IDBObjectStore, id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Audio durability worker IndexedDB request failed'));
    });
}

function awaitCompletion(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
            reject(transaction.error ?? new Error('Audio durability worker read transaction failed'));
        transaction.onerror = () =>
            reject(transaction.error ?? new Error('Audio durability worker read transaction failed'));
    });
}

async function readDurability(ids: readonly string[]): Promise<AudioBufferDurabilityResponse> {
    if (ids.length === 0) {
        return { status: 'complete', revisions: [] };
    }
    if (typeof indexedDB === 'undefined') {
        return { status: 'unavailable' };
    }
    const database = await openExistingDatabase();
    try {
        const transaction = database.transaction([AUDIO_BUFFER_PCM_STORE, AUDIO_BUFFER_METADATA_STORE], 'readonly');
        const pcm = transaction.objectStore(AUDIO_BUFFER_PCM_STORE);
        const metadata = transaction.objectStore(AUDIO_BUFFER_METADATA_STORE);
        const [, revisions] = await Promise.all([
            awaitCompletion(transaction),
            Promise.all(
                ids.map(async (id) => {
                    const [data, meta] = await Promise.all([readRecord(pcm, id), readRecord(metadata, id)]);
                    return readDurableAudioBufferRevision(data, meta);
                })
            ),
        ]);
        return { status: 'complete', revisions };
    } finally {
        database.close();
    }
}

async function answer(data: unknown): Promise<AudioBufferDurabilityResponse> {
    const ids = readRequestIds(data);
    if (ids === undefined) {
        return { status: 'failed' };
    }
    try {
        return await readDurability(ids);
    } catch {
        return { status: 'failed' };
    }
}

self.onmessage = (event: MessageEvent<unknown>) => {
    // The browser delivers dedicated Worker messages through its implicit port with no source object.
    if (event.isTrusted && event.source === null) {
        void answer(event.data).then((result) => self.postMessage(result));
    }
};

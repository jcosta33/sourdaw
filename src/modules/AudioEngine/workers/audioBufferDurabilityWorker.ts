/// <reference lib="webworker" />

import { readIndexedDbRecordPairs } from '#/infra/storage/readIndexedDbRecordPairs';

import {
    AUDIO_BUFFER_DATABASE_NAME,
    AUDIO_BUFFER_DATABASE_VERSION,
    AUDIO_BUFFER_METADATA_STORE,
    AUDIO_BUFFER_PCM_STORE,
    readDurableAudioBufferRevision,
    type AudioBufferDurabilityRequest,
    type AudioBufferDurabilityResponse,
} from '../models/AudioBufferDurability';

function openExistingDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(AUDIO_BUFFER_DATABASE_NAME, AUDIO_BUFFER_DATABASE_VERSION);
        let blocked = false;
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onblocked = () => {
            blocked = true;
            reject(new Error('Audio buffer database open is blocked'));
        };
        request.onerror = () => reject(request.error ?? new Error('Audio buffer database open failed'));
        request.onsuccess = () => {
            const database = request.result;
            if (blocked) {
                database.close();
                return;
            }
            database.onversionchange = () => database.close();
            resolve(database);
        };
    });
}

async function readDurability(ids: readonly string[]): Promise<AudioBufferDurabilityResponse> {
    if (typeof indexedDB === 'undefined') {
        return { status: 'unavailable' };
    }
    let database: IDBDatabase | undefined;
    try {
        database = await openExistingDatabase();
        const revisions = await readIndexedDbRecordPairs(
            database,
            [AUDIO_BUFFER_PCM_STORE, AUDIO_BUFFER_METADATA_STORE],
            ids,
            readDurableAudioBufferRevision
        );
        return { status: 'complete', revisions };
    } catch {
        return { status: 'failed' };
    } finally {
        database?.close();
    }
}

self.onmessage = ({ data }: MessageEvent<AudioBufferDurabilityRequest>): void => {
    void readDurability(data.ids).then((result) => self.postMessage(result));
};

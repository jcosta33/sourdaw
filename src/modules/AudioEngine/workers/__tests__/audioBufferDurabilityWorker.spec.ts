import { IDBDatabase as FakeDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AUDIO_BUFFER_DATABASE_NAME,
    AUDIO_BUFFER_DATABASE_VERSION,
    AUDIO_BUFFER_METADATA_STORE,
    AUDIO_BUFFER_PCM_STORE,
} from '../../models/AudioBufferDurability';

function openDatabase(version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(AUDIO_BUFFER_DATABASE_NAME, version);
        request.onupgradeneeded = () => {
            request.result.createObjectStore(AUDIO_BUFFER_PCM_STORE);
            request.result.createObjectStore(AUDIO_BUFFER_METADATA_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Test database open failed'));
    });
}

async function seedDatabase(version: number): Promise<void> {
    const database = await openDatabase(version);
    try {
        const transaction = database.transaction([AUDIO_BUFFER_PCM_STORE, AUDIO_BUFFER_METADATA_STORE], 'readwrite');
        const pcmStore = transaction.objectStore(AUDIO_BUFFER_PCM_STORE);
        const metaStore = transaction.objectStore(AUDIO_BUFFER_METADATA_STORE);
        const pcm = {
            channelData: [new Float32Array([0.5, -0.75])],
            lastAccessed: 1,
            numberOfChannels: 1,
            sampleRate: 48_000,
            sizeInBytes: 8,
        };
        const meta = { lastAccessed: 1, sizeInBytes: 8 };
        pcmStore.put(pcm, 'ordinary');
        metaStore.put({ ...meta, persistenceRevision: 'ordinary-revision' }, 'ordinary');
        pcmStore.put(pcm, 'prepared');
        metaStore.put(
            {
                ...meta,
                preparedOwner: {
                    schemaVersion: 1,
                    leaseId: 'lease',
                    status: 'project-owned',
                    persistenceRevision: 'prepared-revision',
                },
            },
            'prepared'
        );
        pcmStore.put(pcm, 'temporary');
        metaStore.put(
            {
                ...meta,
                preparedOwner: {
                    schemaVersion: 1,
                    leaseId: 'lease',
                    status: 'temporary',
                    persistenceRevision: 'temporary-revision',
                },
            },
            'temporary'
        );
        metaStore.put({ ...meta, persistenceRevision: 'metadata-alone' }, 'missing');
        pcmStore.put({ ...pcm, channelData: [new Float32Array(1)] }, 'invalid-pcm');
        metaStore.put({ ...meta, persistenceRevision: 'invalid-pcm-revision' }, 'invalid-pcm');
        pcmStore.put(pcm, 'mismatched-size');
        metaStore.put({ ...meta, persistenceRevision: 'size-revision', sizeInBytes: 4 }, 'mismatched-size');
        pcmStore.put(pcm, 'unversioned');
        metaStore.put(meta, 'unversioned');
        await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error ?? new Error('Test seed transaction aborted'));
        });
    } finally {
        database.close();
    }
}

async function requestWorker(ids: string[]): Promise<unknown> {
    const reply = Promise.withResolvers<unknown>();
    vi.spyOn(self, 'postMessage').mockImplementation((message: unknown) => reply.resolve(message));
    await import('../audioBufferDurabilityWorker');
    if (!self.onmessage) {
        throw new Error('Expected the audio durability Worker entry');
    }
    self.onmessage(new MessageEvent('message', { data: { ids } }));
    return reply.promise;
}

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
    self.onmessage = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('audioBufferDurabilityWorker', () => {
    it('reads one PCM and metadata transaction and returns only validated revisions in request order', async () => {
        await seedDatabase(AUDIO_BUFFER_DATABASE_VERSION);
        const transaction = vi.spyOn(FakeDatabase.prototype, 'transaction');
        const close = vi.spyOn(FakeDatabase.prototype, 'close');
        const ids = ['invalid-pcm', 'prepared', 'missing', 'ordinary', 'mismatched-size', 'temporary', 'unversioned'];

        await expect(requestWorker(ids)).resolves.toEqual({
            status: 'complete',
            revisions: [null, 'prepared-revision', null, 'ordinary-revision', null, null, null],
        });
        expect(transaction).toHaveBeenCalledExactlyOnceWith(
            [AUDIO_BUFFER_PCM_STORE, AUDIO_BUFFER_METADATA_STORE],
            'readonly'
        );
        expect(close).toHaveBeenCalledOnce();
    });

    it('refuses to upgrade an older database and releases its connection', async () => {
        const version = AUDIO_BUFFER_DATABASE_VERSION - 1;
        await seedDatabase(version);

        await expect(requestWorker(['ordinary'])).resolves.toEqual({ status: 'failed' });
        const database = await openDatabase(version);
        try {
            expect(database.version).toBe(version);
        } finally {
            database.close();
        }
    });
});

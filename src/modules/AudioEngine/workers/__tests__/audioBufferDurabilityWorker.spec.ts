import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AUDIO_BUFFER_DATABASE_NAME,
    AUDIO_BUFFER_DATABASE_VERSION,
    AUDIO_BUFFER_METADATA_STORE,
    AUDIO_BUFFER_PCM_STORE,
} from '../../models/AudioBufferStorageSchema';

const pcm = {
    sampleRate: 48_000,
    numberOfChannels: 1,
    channelData: [new Float32Array([0.25, -0.5])],
    sizeInBytes: 8,
    lastAccessed: 11,
};
const metadata = { sizeInBytes: 8, lastAccessed: 11 };
const owner = { schemaVersion: 1, leaseId: 'lease', status: 'project-owned', persistenceRevision: 'promoted' };
const namedStores = [AUDIO_BUFFER_PCM_STORE, AUDIO_BUFFER_METADATA_STORE];

type WorkerMessageEvent = Pick<MessageEvent<unknown>, 'data' | 'isTrusted' | 'source'>;

let databaseFactory: IDBFactory;
let worker: {
    onmessage?: (event: WorkerMessageEvent) => void;
    postMessage: (data: unknown) => void;
};

async function seedDatabase(): Promise<void> {
    const request = indexedDB.open(AUDIO_BUFFER_DATABASE_NAME, AUDIO_BUFFER_DATABASE_VERSION);
    await new Promise<void>((resolve, reject) => {
        request.onupgradeneeded = () => {
            const buffer = request.result.createObjectStore(AUDIO_BUFFER_PCM_STORE);
            const meta = request.result.createObjectStore(AUDIO_BUFFER_METADATA_STORE);
            buffer.put(pcm, 'a-ordinary');
            meta.put({ ...metadata, persistenceRevision: 'original' }, 'a-ordinary');
            buffer.put(pcm, 'z-promoted');
            meta.put({ ...metadata, preparedOwner: owner }, 'z-promoted');
            buffer.put(pcm, 'unsettled');
            meta.put({ ...metadata, preparedOwner: { ...owner, promotionRevision: 'pending' } }, 'unsettled');
            buffer.put(pcm, 'wrong-size');
            meta.put({ ...metadata, sizeInBytes: 4, persistenceRevision: 'bad' }, 'wrong-size');
            meta.put({ ...metadata, persistenceRevision: 'missing' }, 'missing-pcm');
            buffer.put(pcm, 'missing-meta');
        };
        request.onsuccess = () => {
            request.result.close();
            resolve();
        };
        request.onerror = () => reject(request.error ?? new Error('Could not seed the audio cache'));
    });
}

function receive(event: WorkerMessageEvent): void {
    if (!worker.onmessage) {
        throw new Error('Audio durability worker did not register its message handler');
    }
    worker.onmessage(event);
}

async function send(data: unknown): Promise<unknown> {
    const reply = Promise.withResolvers<unknown>();
    worker.postMessage = reply.resolve;
    // Model the browser's dedicated Worker dispatch at the handler boundary.
    receive({ data, isTrusted: true, source: null });
    return reply.promise;
}

describe('audioBufferDurabilityWorker', () => {
    beforeEach(async () => {
        vi.resetModules();
        databaseFactory = new IDBFactory();
        worker = { postMessage: vi.fn() };
        vi.stubGlobal('indexedDB', databaseFactory);
        vi.stubGlobal('self', worker);
        await import('../audioBufferDurabilityWorker');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('validates each PCM and metadata pair in one readonly transaction and replies after completion', async () => {
        await seedDatabase();
        const order: string[] = [];
        const original = IDBDatabase.prototype.transaction;
        const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
            this: IDBDatabase,
            ...args: Parameters<IDBDatabase['transaction']>
        ) {
            const pending = original.apply(this, args);
            pending.addEventListener('complete', () => order.push('committed'));
            return pending;
        });
        const reply = await send({
            ids: ['z-promoted', 'a-ordinary', 'unsettled', 'wrong-size', 'missing-pcm', 'missing-meta'],
        });
        order.push('replied');

        expect(transaction).toHaveBeenCalledExactlyOnceWith(namedStores, 'readonly');
        expect(order).toEqual(['committed', 'replied']);
        expect(reply).toEqual({ status: 'complete', revisions: ['promoted', 'original', null, null, null, null] });
    });

    it.each([
        { name: 'a synthetic event', isTrusted: false, source: null },
        { name: 'a message with a source window', isTrusted: true, source: window },
    ])('ignores $name before database access or reply', ({ isTrusted, source }) => {
        const open = vi.spyOn(databaseFactory, 'open');
        const reply = vi.spyOn(worker, 'postMessage');

        receive({ data: { ids: ['a-ordinary'] }, isTrusted, source });

        expect(open).not.toHaveBeenCalled();
        expect(reply).not.toHaveBeenCalled();
    });

    it('rejects malformed requests before opening the database', async () => {
        const open = vi.spyOn(databaseFactory, 'open');

        await expect(send({ ids: ['valid', 2] })).resolves.toEqual({ status: 'failed' });
        await expect(send({ ids: [] })).resolves.toEqual({ status: 'complete', revisions: [] });
        expect(open).not.toHaveBeenCalled();
    });

    it('refuses an absent database and does not create it', async () => {
        await expect(send({ ids: ['a-ordinary'] })).resolves.toEqual({ status: 'failed' });
        await expect(databaseFactory.databases()).resolves.toEqual([]);
    });

    it('refuses an interrupted audio transaction even when the rows are valid', async () => {
        await seedDatabase();
        const original = IDBDatabase.prototype.transaction;
        vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(function (
            this: IDBDatabase,
            ...args: Parameters<IDBDatabase['transaction']>
        ) {
            const pending = original.apply(this, args);
            queueMicrotask(() => pending.abort());
            return pending;
        });

        await expect(send({ ids: ['a-ordinary'] })).resolves.toEqual({ status: 'failed' });
    });
});

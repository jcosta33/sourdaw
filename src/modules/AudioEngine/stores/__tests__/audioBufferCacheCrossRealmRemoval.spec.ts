import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager, type ControlledLockManager } from '#/infra/testing/createControlledLockManager';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';

const AUDIO_DATABASE_NAME = 'sourdaw-audio';
const BUFFER_STORE_NAME = 'buffers';
const METADATA_STORE_NAME = 'bufferMeta';
const STORAGE_LOCK_NAME = 'sourdaw:project-audio-storage';

type AudioRealm = {
    audioBufferCache: typeof import('../audioBufferCache').audioBufferCache;
    clearRuntimeAudioBufferCache: typeof import('../audioBufferCache').clearRuntimeAudioBufferCache;
    ownershipProvider: () => Promise<readonly string[]>;
    setDurableAudioBufferOwnershipProvider: typeof import('../durableAudioBufferOwnership').setDurableAudioBufferOwnershipProvider;
};

type NormalizedStoredRows = {
    metadata: {
        lastAccessed: number;
        sizeInBytes: number;
    } | null;
    record: {
        channelData: number[][];
        lastAccessed: number;
        numberOfChannels: number;
        sampleRate: number;
        sizeInBytes: number;
    } | null;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

function createAudioBuffer(sample: number): AudioBuffer {
    const channel = new Float32Array([sample]);
    return {
        copyFromChannel: (destination: Float32Array) => destination.set(channel),
        copyToChannel: (source: Float32Array) => channel.set(source),
        duration: 1 / 48_000,
        getChannelData: () => channel,
        length: 1,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isFloat32Array(value: unknown): value is Float32Array {
    return Object.prototype.toString.call(value) === '[object Float32Array]';
}

function normalizeStoredRecord(value: unknown): NormalizedStoredRows['record'] {
    if (value === undefined) {
        return null;
    }
    if (!isRecord(value) || !Array.isArray(value.channelData)) {
        throw new TypeError('Stored audio row is not a serialized audio buffer');
    }
    const channelData = value.channelData.map((channel) => {
        if (!isFloat32Array(channel)) {
            throw new TypeError('Stored audio channel is not Float32 PCM');
        }
        return Array.from(channel);
    });
    if (
        typeof value.sampleRate !== 'number' ||
        typeof value.numberOfChannels !== 'number' ||
        typeof value.lastAccessed !== 'number' ||
        typeof value.sizeInBytes !== 'number'
    ) {
        throw new TypeError('Stored audio row metadata is malformed');
    }
    return {
        channelData,
        lastAccessed: value.lastAccessed,
        numberOfChannels: value.numberOfChannels,
        sampleRate: value.sampleRate,
        sizeInBytes: value.sizeInBytes,
    };
}

function normalizeStoredMetadata(value: unknown): NormalizedStoredRows['metadata'] {
    if (value === undefined) {
        return null;
    }
    if (!isRecord(value) || typeof value.lastAccessed !== 'number' || typeof value.sizeInBytes !== 'number') {
        throw new TypeError('Stored audio metadata row is malformed');
    }
    return { lastAccessed: value.lastAccessed, sizeInBytes: value.sizeInBytes };
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')));
    });
}

function transactionSettlement(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve());
        transaction.addEventListener('abort', () =>
            reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
        );
        transaction.addEventListener('error', () =>
            reject(transaction.error ?? new Error('IndexedDB transaction failed'))
        );
    });
}

function openAudioDatabase(): Promise<IDBDatabase> {
    const request = indexedDB.open(AUDIO_DATABASE_NAME);
    return requestResult(request);
}

async function readStoredRows(id: string): Promise<NormalizedStoredRows> {
    const database = await openAudioDatabase();
    try {
        const transaction = database.transaction([BUFFER_STORE_NAME, METADATA_STORE_NAME], 'readonly');
        const settled = transactionSettlement(transaction);
        const [record, metadata] = await Promise.all([
            requestResult(transaction.objectStore(BUFFER_STORE_NAME).get(id)),
            requestResult(transaction.objectStore(METADATA_STORE_NAME).get(id)),
        ]);
        await settled;
        return {
            metadata: normalizeStoredMetadata(metadata),
            record: normalizeStoredRecord(record),
        };
    } finally {
        database.close();
    }
}

async function loadAudioRealm(): Promise<AudioRealm> {
    const [cache, ownership] = await Promise.all([
        import('../audioBufferCache'),
        import('../durableAudioBufferOwnership'),
    ]);
    const ownershipProvider = vi.fn(() => Promise.resolve([]));
    ownership.setDurableAudioBufferOwnershipProvider(ownershipProvider);
    return {
        audioBufferCache: cache.audioBufferCache,
        clearRuntimeAudioBufferCache: cache.clearRuntimeAudioBufferCache,
        ownershipProvider,
        setDurableAudioBufferOwnershipProvider: ownership.setDurableAudioBufferOwnershipProvider,
    };
}

describe('audioBufferCache cross-realm removal', () => {
    let installation: TransactionalIndexedDbInstallation;
    let lockManager: ControlledLockManager;
    let realms: AudioRealm[];

    beforeEach(() => {
        vi.resetModules();
        lockManager = createControlledLockManager();
        vi.stubGlobal('navigator', { ...navigator, locks: lockManager.locks });
        installation = installTransactionalIndexedDb();
        realms = [];
    });

    afterEach(async () => {
        for (const realm of realms) {
            realm.setDurableAudioBufferOwnershipProvider(null);
            realm.clearRuntimeAudioBufferCache();
        }
        await installation.dispose();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    async function reproduceCrossRealmReplacement(deletion: 'clear' | 'remove'): Promise<void> {
        const id = `cross-realm-${deletion}`;
        const realmA = await loadAudioRealm();
        realms.push(realmA);
        realmA.audioBufferCache.set(id, createAudioBuffer(0.1));
        const initialDurability = await realmA.audioBufferCache.ensureDurable([id]);
        expect(initialDurability.status).toBe('durable');
        if (initialDurability.status === 'durable') {
            initialDurability.release();
        }
        const initialRows = await readStoredRows(id);
        expect(initialRows.record?.channelData).toEqual([[Math.fround(0.1)]]);
        expect(initialRows.metadata?.sizeInBytes).toBe(Float32Array.BYTES_PER_ELEMENT);
        const requestsBeforeHolder = lockManager.requestedNames.length;

        const entered = deferred();
        const release = deferred();
        const holder = lockManager.locks.request(STORAGE_LOCK_NAME, { mode: 'exclusive' }, async () => {
            entered.resolve();
            await release.promise;
        });
        await entered.promise;

        if (deletion === 'remove') {
            realmA.audioBufferCache.remove(id);
        } else {
            realmA.audioBufferCache.clear();
        }
        expect(lockManager.requestedNames.slice(requestsBeforeHolder)).toEqual([STORAGE_LOCK_NAME, STORAGE_LOCK_NAME]);

        vi.resetModules();
        const realmB = await loadAudioRealm();
        realms.push(realmB);
        expect(realmB.audioBufferCache).not.toBe(realmA.audioBufferCache);

        let replacementDurability: Awaited<ReturnType<AudioRealm['audioBufferCache']['ensureDurable']>> | undefined;
        try {
            realmB.audioBufferCache.set(id, createAudioBuffer(0.9));
            const replacementDurabilityPromise = realmB.audioBufferCache.ensureDurable([id]);
            expect(lockManager.requestedNames.slice(requestsBeforeHolder)).toEqual([
                STORAGE_LOCK_NAME,
                STORAGE_LOCK_NAME,
                STORAGE_LOCK_NAME,
                STORAGE_LOCK_NAME,
            ]);
            release.resolve();
            await holder;
            replacementDurability = await replacementDurabilityPromise;
        } finally {
            release.resolve();
            await holder;
            await lockManager.locks.request(STORAGE_LOCK_NAME, { mode: 'exclusive' }, async () => undefined);
        }

        expect(replacementDurability?.status).toBe('durable');
        if (replacementDurability?.status === 'durable') {
            replacementDurability.release();
        }
        const rowsAfterRealmA = await readStoredRows(id);
        expect(realmA.ownershipProvider).toHaveBeenCalledOnce();
        expect(realmB.ownershipProvider).not.toHaveBeenCalled();
        expect(rowsAfterRealmA.record?.channelData).toEqual([[Math.fround(0.9)]]);
        expect(rowsAfterRealmA.metadata?.lastAccessed).toBe(rowsAfterRealmA.record?.lastAccessed);
        expect(rowsAfterRealmA.metadata?.sizeInBytes).toBe(rowsAfterRealmA.record?.sizeInBytes);
    }

    it('a delayed remove cannot delete a replacement committed by another module instance', async () => {
        await reproduceCrossRealmReplacement('remove');
    });

    it('a delayed clear cannot delete a replacement committed by another module instance', async () => {
        await reproduceCrossRealmReplacement('clear');
    });
});

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDurableAssetIndexedDb } from '../../repositories/durableAssetIndexedDb';
import { createDurableAssetRepository } from '../../repositories/durableAssetRepository';
import { restoreProjectOriginalMedia } from '../restoreProjectOriginalMedia';

const indexedDb = createDurableAssetIndexedDb();

beforeAll(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    const nativeClone = structuredClone;
    vi.stubGlobal('structuredClone', (value: unknown) => {
        const cloned: unknown = nativeClone(value);
        if (
            typeof value === 'object' &&
            value !== null &&
            'blob' in value &&
            value.blob instanceof Blob &&
            typeof cloned === 'object' &&
            cloned !== null
        ) {
            Reflect.set(cloned, 'blob', value.blob.slice());
        }
        return cloned;
    });
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllGlobals());

async function original(text: string) {
    const bytes = new TextEncoder().encode(text);
    return { bytes, hash: await indexedDb.hashBlob(new Blob([bytes])) };
}

async function storageSnapshot() {
    const database = await indexedDb.openDurableAssetDatabase();
    const stores = Array.from(database.objectStoreNames);
    const transaction = database.transaction(stores, 'readonly');
    const completion = indexedDb.awaitTransaction(transaction);
    const values = await Promise.all(
        stores.map(
            (store) =>
                new Promise<unknown[]>((resolve, reject) => {
                    const request = transaction.objectStore(store).getAll();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                })
        )
    );
    await completion;
    return JSON.stringify(values);
}

describe('restoreProjectOriginalMedia integrity before ownership', () => {
    it.each([0, 1])('rejects corrupt entry %i without changing any owner, lease or recovery', async (badIndex) => {
        const owner = `rejected-${badIndex}`;
        const first = await original(`first-${badIndex}`);
        const second = await original(`second-${badIndex}`);
        const existing = await original(`open-project-${badIndex}`);
        const repository = createDurableAssetRepository(owner);
        const saved = await repository.stageAsset(`saved-${badIndex}`, new Blob([existing.bytes]), 'saved.wav');
        await repository.promoteStagedAsset(saved.leaseId, saved.hash);
        const foreign = createDurableAssetRepository(`foreign-${badIndex}`);
        await foreign.stageAsset(`foreign-stage-${badIndex}`, new Blob([first.bytes]), 'shared.wav');
        const before = await storageSnapshot();
        const media = new Map([
            [first.hash, first.bytes],
            [second.hash, second.bytes],
        ]);
        media.set([first.hash, second.hash][badIndex]!, new Uint8Array([99]));

        await expect(restoreProjectOriginalMedia(owner, media, () => true)).rejects.toThrow();

        expect(await storageSnapshot()).toBe(before);
        expect(await repository.reopenDurableAsset(first.hash)).toMatchObject({
            status: 'failed',
            reason: 'asset-not-owned',
        });
        expect(await repository.reopenDurableAsset(existing.hash)).toMatchObject({ status: 'opened' });
    });

    it('retains both valid originals and preserves an already owned first entry', async () => {
        const owner = 'valid-two';
        const first = await original('valid-first');
        const second = await original('valid-second');
        await restoreProjectOriginalMedia(owner, new Map([[first.hash, first.bytes]]), () => true);
        await restoreProjectOriginalMedia(
            owner,
            new Map([
                [first.hash, first.bytes],
                [second.hash, second.bytes],
            ]),
            () => true
        );
        const repository = createDurableAssetRepository(owner);
        for (const entry of [first, second]) {
            const opened = await repository.reopenDurableAsset(entry.hash);
            expect(opened.status).toBe('opened');
            if (opened.status !== 'opened') {
                throw new Error('Expected owned original');
            }
            expect(Array.from(new Uint8Array(await opened.blob.arrayBuffer()))).toEqual(Array.from(entry.bytes));
        }
    });

    it('validates incoming bytes even when their claimed hash is already owned', async () => {
        const owner = 'existing-corrupt-incoming';
        const first = await original('already-owned');
        await restoreProjectOriginalMedia(owner, new Map([[first.hash, first.bytes]]), () => true);
        const before = await storageSnapshot();

        await expect(
            restoreProjectOriginalMedia(owner, new Map([[first.hash, new Uint8Array([0])]]), () => true)
        ).rejects.toThrow('hash mismatch');

        expect(await storageSnapshot()).toBe(before);
    });

    it('preserves an already owned first original when a later original is corrupt', async () => {
        const owner = 'owned-first-corrupt-second';
        const first = await original('owned-first');
        const second = await original('corrupt-after-owned-first');
        await restoreProjectOriginalMedia(owner, new Map([[first.hash, first.bytes]]), () => true);
        const before = await storageSnapshot();

        await expect(
            restoreProjectOriginalMedia(
                owner,
                new Map([
                    [first.hash, first.bytes],
                    [second.hash, new Uint8Array([0])],
                ]),
                () => true
            )
        ).rejects.toThrow('hash mismatch');

        expect(await storageSnapshot()).toBe(before);
        expect(await createDurableAssetRepository(owner).reopenDurableAsset(first.hash)).toMatchObject({
            status: 'opened',
        });
    });

    it('releases the actual staged hash if incoming bytes change after validation', async () => {
        const owner = 'changed-after-validation';
        const entry = await original('mutable-incoming');
        const changed = await original('Xutable-incoming');
        const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
            const digest = await nativeDigest(...args);
            entry.bytes.set(changed.bytes);
            return digest;
        });

        await expect(
            restoreProjectOriginalMedia(owner, new Map([[entry.hash, entry.bytes]]), () => true)
        ).rejects.toThrow('hash mismatch');

        const repository = createDurableAssetRepository(owner);
        expect(await repository.reopenDurableAsset(changed.hash)).toMatchObject({
            status: 'failed',
            reason: 'missing-asset',
        });
        expect(await repository.resumeRecoveries()).toEqual({
            status: 'resumed',
            ownerId: owner,
            recoveryCount: 0,
            promotedHashes: [],
        });
    });

    it('makes no durable writes when superseded during hashing', async () => {
        const first = await original('cancelled-hash-first');
        const second = await original('cancelled-hash-second');
        const before = await storageSnapshot();
        const hashing = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
            hashing.resolve();
            await resume.promise;
            return nativeDigest(...args);
        });
        let current = true;
        const operation = restoreProjectOriginalMedia(
            'cancelled-hash',
            new Map([
                [first.hash, first.bytes],
                [second.hash, second.bytes],
            ]),
            () => current
        );
        await hashing.promise;
        current = false;
        const rejected = expect(operation).rejects.toThrow('superseded');
        resume.resolve();
        await rejected;

        expect(await storageSnapshot()).toBe(before);
        await restoreProjectOriginalMedia(
            'cancelled-hash',
            new Map([
                [first.hash, first.bytes],
                [second.hash, second.bytes],
            ]),
            () => true
        );
        const repository = createDurableAssetRepository('cancelled-hash');
        expect(await repository.reopenDurableAsset(first.hash)).toMatchObject({ status: 'opened' });
        expect(await repository.reopenDurableAsset(second.hash)).toMatchObject({ status: 'opened' });
    });
});

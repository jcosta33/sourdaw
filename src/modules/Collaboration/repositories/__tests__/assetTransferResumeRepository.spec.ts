import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBOpenDBRequest, IDBVersionChangeEvent } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ASSET_RESUME_CHUNKS, ASSET_RESUME_METADATA, type ResumeManifest } from '../../models/AssetTransferResume';
import { MIN_ASSET_CHUNK_SIZE } from '../../models/CollaborationTypes';
import { openAssetTransferResumeDatabase } from '../assetTransferResumeIndexedDb';
import { createAssetTransferResumeRepository } from '../assetTransferResumeRepository';

const OWNER = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
const HASH = `sha256:${'1'.repeat(64)}`;
const DIGEST = `sha256:${'2'.repeat(64)}`;
const manifest: ResumeManifest = {
    hash: HASH,
    size: MIN_ASSET_CHUNK_SIZE * 2,
    chunkSize: MIN_ASSET_CHUNK_SIZE,
    chunkCount: 2,
    name: 'journal.wav',
    mime: 'audio/wav',
};

beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function counts(): Promise<number[]> {
    const database = await openAssetTransferResumeDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([ASSET_RESUME_METADATA, ASSET_RESUME_CHUNKS], 'readonly');
        const metadata = transaction.objectStore(ASSET_RESUME_METADATA).count();
        const chunks = transaction.objectStore(ASSET_RESUME_CHUNKS).count();
        transaction.oncomplete = () => {
            database.close();
            resolve([metadata.result, chunks.result]);
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error);
        };
    });
}

describe('temporary asset journal transactions', () => {
    it('persists only six manifest fields from an extended network object across a reopened connection', async () => {
        const wireManifest = { ...manifest, integrityVersion: 1, unrelatedMarker: 'bounded-unknown-wire-field' };
        await createAssetTransferResumeRepository(OWNER).begin(wireManifest, 'writer');
        const database = await openAssetTransferResumeDatabase();
        const stored: unknown = await new Promise((resolve, reject) => {
            const transaction = database.transaction(ASSET_RESUME_METADATA, 'readonly');
            const request = transaction.objectStore(ASSET_RESUME_METADATA).get([OWNER, HASH]);
            transaction.oncomplete = () => {
                database.close();
                resolve(request.result);
            };
            transaction.onabort = () => {
                database.close();
                reject(transaction.error);
            };
        });
        if (
            !stored ||
            typeof stored !== 'object' ||
            !('manifest' in stored) ||
            !stored.manifest ||
            typeof stored.manifest !== 'object'
        ) {
            throw new TypeError('Expected the raw stored manifest');
        }
        expect(Object.keys(stored.manifest).sort()).toEqual(Object.keys(manifest).sort());
        expect(stored.manifest).toEqual(manifest);
        expect(wireManifest.integrityVersion).toBe(1);
        expect(wireManifest.unrelatedMarker).toBe('bounded-unknown-wire-field');
    });

    it('closes a late successful open after the same request was rejected as blocked', async () => {
        const database = await openAssetTransferResumeDatabase();
        const close = vi.spyOn(database, 'close');
        const request = new IDBOpenDBRequest();
        vi.spyOn(indexedDB, 'open').mockReturnValue(request);
        const pending = openAssetTransferResumeDatabase();
        request.onblocked?.call(request, new IDBVersionChangeEvent('blocked'));
        await expect(pending).rejects.toThrow('Asset resume storage upgrade is blocked');
        expect(close).not.toHaveBeenCalled();
        Object.defineProperty(request, 'result', { value: database });
        request.onsuccess?.call(request, new Event('success'));
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('reopens committed bytes through a new connection and fences an old writer and cleanup', async () => {
        const first = createAssetTransferResumeRepository(OWNER);
        const initial = await first.begin(manifest, 'first-writer');
        const written = await first.append(initial, 0, new Uint8Array(MIN_ASSET_CHUNK_SIZE).fill(9), DIGEST);
        const successor = createAssetTransferResumeRepository(OWNER);
        const restored = await successor.claim(HASH, 'second-writer');
        expect(restored?.metadata.received).toEqual([0]);
        expect(restored?.chunks[0]?.data).toEqual(new Uint8Array(MIN_ASSET_CHUNK_SIZE).fill(9));
        await expect(first.append(written, 1, new Uint8Array(MIN_ASSET_CHUNK_SIZE), DIGEST)).rejects.toThrow(
            'superseded'
        );
        expect(await first.remove(written)).toBe(false);
        expect(await counts()).toEqual([1, 1]);
        if (!restored) {
            throw new Error('Expected a committed journal');
        }
        expect(await successor.remove(restored.metadata)).toBe(true);
        expect(await counts()).toEqual([0, 0]);
    });

    it('publishes neither chunk nor bit when the transaction aborts after put success', async () => {
        const repository = createAssetTransferResumeRepository(OWNER);
        const initial = await repository.begin(manifest, 'writer');
        const put = IDBObjectStore.prototype.put;
        let requestSucceeded = false;
        const aborting = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            ...args
        ) {
            const request = put.apply(this, args);
            if (this.name === ASSET_RESUME_CHUNKS) {
                request.addEventListener(
                    'success',
                    () => {
                        requestSucceeded = true;
                        this.transaction.abort();
                    },
                    { once: true }
                );
            }
            return request;
        });
        await expect(repository.append(initial, 0, new Uint8Array(MIN_ASSET_CHUNK_SIZE), DIGEST)).rejects.toThrow();
        expect(requestSucceeded).toBe(true);
        aborting.mockRestore();
        const reopened = await createAssetTransferResumeRepository(OWNER).claim(HASH, 'after-abort');
        expect(reopened?.metadata.received).toEqual([]);
        expect(reopened?.chunks).toEqual([]);
        expect(await counts()).toEqual([1, 0]);
    });

    it('leaves the previous committed revision intact on quota refusal', async () => {
        const repository = createAssetTransferResumeRepository(OWNER);
        const initial = await repository.begin(manifest, 'writer');
        const put = IDBObjectStore.prototype.put;
        const quota = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            ...args
        ) {
            if (this.name === ASSET_RESUME_CHUNKS) {
                throw new DOMException('Controlled quota refusal', 'QuotaExceededError');
            }
            return put.apply(this, args);
        });
        await expect(repository.append(initial, 0, new Uint8Array(MIN_ASSET_CHUNK_SIZE), DIGEST)).rejects.toThrow(
            'Controlled quota refusal'
        );
        quota.mockRestore();
        const reopened = await createAssetTransferResumeRepository(OWNER).claim(HASH, 'after-quota');
        expect(reopened?.metadata.received).toEqual([]);
        expect(reopened?.chunks).toEqual([]);
    });

    it('aborts held work when its exact runtime authority is revoked', async () => {
        const repository = createAssetTransferResumeRepository(OWNER);
        const initial = await repository.begin(manifest, 'writer');
        const controller = new AbortController();
        const put = IDBObjectStore.prototype.put;
        const cancelling = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
            this: IDBObjectStore,
            ...args
        ) {
            const request = put.apply(this, args);
            if (this.name === ASSET_RESUME_CHUNKS) {
                request.addEventListener('success', () => controller.abort(), { once: true });
            }
            return request;
        });
        await expect(
            repository.append(initial, 0, new Uint8Array(MIN_ASSET_CHUNK_SIZE), DIGEST, {
                signal: controller.signal,
                isCurrent: () => !controller.signal.aborted,
            })
        ).rejects.toThrow();
        cancelling.mockRestore();
        expect((await createAssetTransferResumeRepository(OWNER).claim(HASH, 'successor'))?.metadata.received).toEqual(
            []
        );
    });

    it('does not let a repository for another owner remove a known generation', async () => {
        const repository = createAssetTransferResumeRepository(OWNER);
        const current = await repository.begin(manifest, 'writer');
        expect(await createAssetTransferResumeRepository('other-owner').remove(current)).toBe(false);
        expect(await counts()).toEqual([1, 0]);
    });

    it.each([
        { index: -1, size: MIN_ASSET_CHUNK_SIZE, digest: DIGEST },
        { index: 2, size: MIN_ASSET_CHUNK_SIZE, digest: DIGEST },
        { index: 0, size: MIN_ASSET_CHUNK_SIZE - 1, digest: DIGEST },
        { index: 0, size: MIN_ASSET_CHUNK_SIZE, digest: 'invalid' },
    ])('refuses invalid chunk geometry or proof without adding bytes or a bit: %j', async ({ index, size, digest }) => {
        const repository = createAssetTransferResumeRepository(OWNER);
        const current = await repository.begin(manifest, 'writer');
        await expect(repository.append(current, index, new Uint8Array(size), digest)).rejects.toThrow(
            'chunk is invalid'
        );
        expect(await counts()).toEqual([1, 0]);
        expect((await repository.claim(HASH, 'reader'))?.metadata.received).toEqual([]);
    });

    it('preserves an unknown metadata shape and reports it rather than replacing its generation', async () => {
        const database = await openAssetTransferResumeDatabase();
        await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction(ASSET_RESUME_METADATA, 'readwrite');
            transaction.objectStore(ASSET_RESUME_METADATA).put({ ownerId: OWNER, hash: HASH, schemaVersion: 99 });
            transaction.oncomplete = () => {
                database.close();
                resolve();
            };
            transaction.onabort = () => {
                database.close();
                reject(transaction.error);
            };
        });
        const repository = createAssetTransferResumeRepository(OWNER);
        await expect(repository.claim(HASH, 'reader')).rejects.toThrow('record is invalid');
        await expect(repository.begin(manifest, 'writer')).rejects.toThrow('record changed');
        expect(await counts()).toEqual([1, 0]);
        expect(await repository.expire(Number.MAX_SAFE_INTEGER)).toBe(0);
    });
});

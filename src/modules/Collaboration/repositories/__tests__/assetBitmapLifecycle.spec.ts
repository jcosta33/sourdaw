import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ASSET_RESUME_MAX_AGE_MS,
    ASSET_RESUME_METADATA,
    type ResumeJournal,
    type ResumeManifest,
} from '../../models/AssetTransferResume';
import { MIN_ASSET_CHUNK_SIZE } from '../../models/CollaborationTypes';
import { startAssetBitmapLifecycle } from '../../useCases/assetBitmapLifecycle';
import { openAssetTransferResumeDatabase } from '../assetTransferResumeIndexedDb';
import { createAssetTransferResumeRepository } from '../assetTransferResumeRepository';

const OWNER = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
const HASH = `sha256:${'1'.repeat(64)}`;
const DIGEST = `sha256:${'2'.repeat(64)}`;
const START = 1_800_000_000_000;
const manifest: ResumeManifest = {
    hash: HASH,
    size: MIN_ASSET_CHUNK_SIZE,
    chunkSize: MIN_ASSET_CHUNK_SIZE,
    chunkCount: 1,
    name: 'expiry.wav',
    mime: 'audio/wav',
};
let stop: (() => void) | undefined;

beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
});
afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('temporary bitmap age and exact terminal lifecycle', () => {
    it('expires only strictly older than 30 days and does not refresh age on a duplicate', async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(START);
        const repository = createAssetTransferResumeRepository(OWNER);
        const initial = await repository.begin(manifest, 'writer');
        const written = await repository.append(initial, 0, new Uint8Array(MIN_ASSET_CHUNK_SIZE), DIGEST);
        clock.mockReturnValue(START + ASSET_RESUME_MAX_AGE_MS);
        const duplicate = await repository.append(written, 0, new Uint8Array(MIN_ASSET_CHUNK_SIZE), DIGEST);
        expect(duplicate.revision).toBe(written.revision);
        expect(duplicate.lastVerifiedProgressAt).toBe(START);
        expect(await repository.expire(START + ASSET_RESUME_MAX_AGE_MS - 1)).toBe(0);
        expect(await repository.expire(START + ASSET_RESUME_MAX_AGE_MS)).toBe(0);
        expect(await repository.expire(START + ASSET_RESUME_MAX_AGE_MS + 1)).toBe(1);
        expect(await createAssetTransferResumeRepository(OWNER).claim(HASH, 'reloaded')).toBeNull();
    });

    it('preserves future timestamps and rejects a stale cleanup against a successor generation', async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(START);
        const repository = createAssetTransferResumeRepository(OWNER);
        const old = await repository.begin(manifest, 'old');
        expect(await repository.expire(START - ASSET_RESUME_MAX_AGE_MS)).toBe(0);
        expect(await repository.remove(old)).toBe(true);
        clock.mockReturnValue(START + 1);
        const successor = await repository.begin(manifest, 'new');
        expect(successor.generation).not.toBe(old.generation);
        expect(await repository.remove(old)).toBe(false);
        const current = await repository.claim(HASH, 'reader');
        expect(current?.metadata.generation).toBe(successor.generation);
    });

    it('runs real expiry on configured lifecycle startup without a reference census', async () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(START);
        const repository = createAssetTransferResumeRepository(OWNER);
        await repository.begin(manifest, 'writer');
        clock.mockReturnValue(START + ASSET_RESUME_MAX_AGE_MS + 1);
        stop = startAssetBitmapLifecycle();
        await vi.waitFor(async () => {
            const database = await openAssetTransferResumeDatabase();
            const count = await new Promise<number>((resolve, reject) => {
                const transaction = database.transaction('transfers', 'readonly');
                const request = transaction.objectStore('transfers').count();
                transaction.oncomplete = () => {
                    database.close();
                    resolve(request.result);
                };
                transaction.onabort = () => {
                    database.close();
                    reject(transaction.error);
                };
            });
            expect(count).toBe(0);
        });
    });

    it('revalidates the scanned generation, writer and revision after a successor claims the same journal', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(START);
        const repository = createAssetTransferResumeRepository(OWNER);
        const initial = await repository.begin(manifest, 'old-writer');
        const written = await repository.append(initial, 0, new Uint8Array(MIN_ASSET_CHUNK_SIZE), DIGEST);
        const nativeGetAll = IDBObjectStore.prototype.getAll;
        let successor: Promise<ResumeJournal | null> | undefined;
        let scannedRevision: number | undefined;
        const scan = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (
            this: IDBObjectStore,
            ...args
        ) {
            const request = nativeGetAll.apply(this, args);
            if (this.name === ASSET_RESUME_METADATA && this.transaction.mode === 'readonly') {
                request.addEventListener(
                    'success',
                    () => {
                        scannedRevision = request.result[0]?.revision;
                    },
                    { once: true }
                );
                this.transaction.addEventListener(
                    'complete',
                    () => {
                        successor = createAssetTransferResumeRepository(OWNER).claim(HASH, 'successor-writer');
                    },
                    { once: true }
                );
            }
            return request;
        });
        expect(await repository.expire(START + ASSET_RESUME_MAX_AGE_MS + 1)).toBe(0);
        scan.mockRestore();
        if (!successor) {
            throw new Error('Expected a successor after the completed census transaction');
        }
        const current = await successor;
        expect(scannedRevision).toBe(written.revision);
        expect(current?.metadata.writerId).toBe('successor-writer');
        expect(current?.metadata.revision).toBe(written.revision + 1);
        expect(current?.metadata.received).toEqual([0]);
        const reopened = await repository.claim(HASH, 'reader');
        expect(reopened?.metadata.generation).toBe(written.generation);
        expect(reopened?.chunks).toHaveLength(1);
    });
});

import { ASSET_RESUME_CHUNKS, ASSET_RESUME_DATABASE, ASSET_RESUME_METADATA } from '../models/AssetTransferResume';

/** Partial transfer storage is deliberately separate from complete original-asset ownership. */
export function openAssetTransferResumeDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
            reject(new Error('Asset resume storage is unavailable'));
            return;
        }
        const request = indexedDB.open(ASSET_RESUME_DATABASE, 1);
        let rejected = false;
        const fail = (error: unknown) => {
            rejected = true;
            reject(error);
        };
        request.onupgradeneeded = () => {
            const database = request.result;
            database.createObjectStore(ASSET_RESUME_METADATA, { keyPath: ['ownerId', 'hash'] });
            database.createObjectStore(ASSET_RESUME_CHUNKS, {
                keyPath: ['ownerId', 'hash', 'generation', 'index'],
            });
        };
        request.onerror = () => fail(request.error ?? new Error('Asset resume storage could not be opened'));
        request.onblocked = () => fail(new Error('Asset resume storage upgrade is blocked'));
        request.onsuccess = () => {
            if (rejected) {
                request.result.close();
                return;
            }
            resolve(request.result);
        };
    });
}

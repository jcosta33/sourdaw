import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLibraryAssetMappings } from '../libraryAssetMappings';

const HASH = `sha256:${'a'.repeat(64)}`;
const binding = { hash: HASH, sampleId: 'sample-one', libraryRootId: 'root-one', relativePath: 'Drums/kick.wav' };

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('sourdaw-library-asset-mappings', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function rawState() {
    const db = await database();
    return new Promise<{ identity: unknown; mappings: unknown[]; keys: IDBValidKey[] }>((resolve, reject) => {
        const transaction = db.transaction(['settings', 'mappings'], 'readonly');
        const identity = transaction.objectStore('settings').get('localPeerSettingsId');
        const mappings = transaction.objectStore('mappings').getAll();
        const keys = transaction.objectStore('mappings').getAllKeys();
        transaction.oncomplete = () => {
            db.close();
            resolve({ identity: identity.result, mappings: mappings.result, keys: keys.result });
        };
        transaction.onabort = () => {
            db.close();
            reject(transaction.error);
        };
    });
}

async function replaceRow(store: string, key: IDBValidKey, value: unknown): Promise<void> {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        transaction.objectStore(store).put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
    }).finally(() => db.close());
}

describe('client-local library asset settings transactions', () => {
    it('creates one stable atomic identity across concurrent writers and reopened factories', async () => {
        const second = { ...binding, hash: `sha256:${'b'.repeat(64)}`, sampleId: 'sample-two' };
        await expect(
            Promise.all([
                createLibraryAssetMappings().remember(binding, () => true),
                createLibraryAssetMappings().remember(second, () => true),
            ])
        ).resolves.toEqual([true, true]);
        const state = await rawState();
        expect(state.identity).toMatch(/^[a-f0-9-]{36}$/);
        expect(state.keys).toEqual([
            [state.identity, HASH],
            [state.identity, second.hash],
        ]);
        expect(state.mappings).toEqual([
            { schemaVersion: 1, localPeerSettingsId: state.identity, ...binding },
            { schemaVersion: 1, localPeerSettingsId: state.identity, ...second },
        ]);
        await expect(createLibraryAssetMappings().find(HASH, () => true)).resolves.toEqual(binding);
        expect((await rawState()).identity).toBe(state.identity);
    });

    it('keeps independent client storage identities and mappings separate', async () => {
        await createLibraryAssetMappings().remember(binding, () => true);
        const first = await rawState();
        vi.stubGlobal('indexedDB', new IDBFactory());
        await expect(createLibraryAssetMappings().find(HASH, () => true)).resolves.toBeNull();
        const second = await rawState();
        expect(second.identity).not.toBe(first.identity);
        expect(second.mappings).toEqual([]);
    });

    it('projects only bounded mapping fields into the actual reopened IDB row', async () => {
        const untrusted = { ...binding, unrelatedMarker: 'unrelated metadata must not become a cache payload' };
        await createLibraryAssetMappings().remember(untrusted, () => true);
        const state = await rawState();
        expect(state.mappings).toEqual([{ schemaVersion: 1, localPeerSettingsId: state.identity, ...binding }]);
        await expect(
            createLibraryAssetMappings().remember({ ...binding, relativePath: 'x'.repeat(4097) }, () => true)
        ).resolves.toBe(false);
        expect((await rawState()).mappings).toEqual(state.mappings);
    });

    it('rejects an abort after the mapping put succeeds and leaves no committed binding', async () => {
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = put.apply(this, args);
            if (this.name === 'mappings') {
                request.addEventListener('success', () => this.transaction.abort(), { once: true });
            }
            return request;
        });
        await expect(createLibraryAssetMappings().remember(binding, () => true)).rejects.toThrow();
        expect((await rawState()).mappings).toEqual([]);
    });

    it('does not report durability when the real mapping write refuses quota', async () => {
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
            if (this.name === 'mappings') {
                throw new DOMException('controlled library settings quota', 'QuotaExceededError');
            }
            return put.apply(this, args);
        });
        await expect(createLibraryAssetMappings().remember(binding, () => true)).rejects.toThrow(
            'controlled library settings quota'
        );
        expect((await rawState()).mappings).toEqual([]);
    });

    it('aborts a stale writer before transaction completion without recording a binding', async () => {
        let current = true;
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
            const request = put.apply(this, args);
            if (this.name === 'mappings') {
                request.addEventListener(
                    'success',
                    () => {
                        current = false;
                    },
                    { once: true }
                );
            }
            return request;
        });
        await expect(createLibraryAssetMappings().remember(binding, () => current)).resolves.toBe(false);
        expect((await rawState()).mappings).toEqual([]);
    });

    it('retains unrecognized rows and rejects hash or identity substitution', async () => {
        const repository = createLibraryAssetMappings();
        await repository.remember(binding, () => true);
        const { identity } = await rawState();
        expect(typeof identity).toBe('string');
        if (typeof identity !== 'string') {
            throw new TypeError('Expected stored local settings identity');
        }
        const unknown = { schemaVersion: 99, localPeerSettingsId: identity, ...binding };
        await replaceRow('mappings', [identity, HASH], unknown);
        await expect(repository.find(HASH, () => true)).resolves.toBeNull();
        expect((await rawState()).mappings).toEqual([unknown]);
        await replaceRow('mappings', [identity, HASH], {
            ...unknown,
            schemaVersion: 1,
            hash: `sha256:${'b'.repeat(64)}`,
        });
        await expect(repository.find(HASH, () => true)).resolves.toBeNull();
        await replaceRow('settings', 'localPeerSettingsId', { unknownIdentity: true });
        await expect(repository.find(HASH, () => true)).rejects.toThrow('settings identity is invalid');
        expect((await rawState()).identity).toEqual({ unknownIdentity: true });
    });
});

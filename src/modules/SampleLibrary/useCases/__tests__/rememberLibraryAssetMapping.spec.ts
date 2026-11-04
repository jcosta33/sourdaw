import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { createLibraryAssetMappings } from '../../repositories/libraryAssetMappings';
import { rememberLibraryAssetMapping } from '../rememberLibraryAssetMapping';

const binding = {
    hash: `sha256:${'a'.repeat(64)}`,
    sampleId: 'sample-one',
    libraryRootId: 'root-one',
    relativePath: 'Drums/kick.wav',
};

function fixture() {
    const state = {
        roots: [{ id: 'root-one', status: 'ready' }],
        samples: [
            { id: 'sample-one', libraryRootId: 'root-one', relativePath: 'Drums/kick.wav', sync: { exists: true } },
        ],
    };
    const mappings = createLibraryAssetMappings();
    injectDependencies(rememberLibraryAssetMapping, { libraryStore: { value: state }, mappings });
    return { state, mappings };
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('rememberLibraryAssetMapping', () => {
    it('persists the exact known local sample provenance after the caller admits its import', async () => {
        const { mappings } = fixture();
        await expect(rememberLibraryAssetMapping({ ...binding, isCurrent: () => true })).resolves.toBe(true);
        await expect(mappings.find(binding.hash, () => true)).resolves.toEqual(binding);
    });

    it('refuses unknown or substituted root, sample and path identities', async () => {
        const { state, mappings } = fixture();
        for (const changed of [
            { sampleId: 'another-sample' },
            { libraryRootId: 'another-root' },
            { relativePath: 'Other/kick.wav' },
        ]) {
            await expect(rememberLibraryAssetMapping({ ...binding, ...changed, isCurrent: () => true })).resolves.toBe(
                false
            );
        }
        state.roots[0]!.status = 'offline';
        await expect(rememberLibraryAssetMapping({ ...binding, isCurrent: () => true })).resolves.toBe(false);
        await expect(mappings.find(binding.hash, () => true)).resolves.toBeNull();
    });

    it('returns an honest refusal for a stale import or storage quota without throwing into project commit', async () => {
        const { mappings } = fixture();
        await expect(rememberLibraryAssetMapping({ ...binding, isCurrent: () => false })).resolves.toBe(false);
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
            if (this.name === 'mappings') {
                throw new DOMException('controlled quota', 'QuotaExceededError');
            }
            return put.apply(this, args);
        });
        await expect(rememberLibraryAssetMapping({ ...binding, isCurrent: () => true })).resolves.toBe(false);
        await expect(mappings.find(binding.hash, () => true)).resolves.toBeNull();
    });
});

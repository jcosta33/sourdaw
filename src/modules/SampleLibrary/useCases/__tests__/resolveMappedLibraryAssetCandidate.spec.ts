import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testOverrides } from '#/infra/di/internal/containerState';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { createLibraryAssetMappings } from '../../repositories/libraryAssetMappings';
import { readBrowserLibrarySampleFile } from '../../repositories/readBrowserLibrarySampleFile';
import { readNativeLibrarySampleFile } from '../readNativeLibrarySampleFile';
import { resolveDroppedSampleFile } from '../resolveDroppedSampleFile';
import { resolveMappedLibraryAssetCandidate } from '../resolveMappedLibraryAssetCandidate';

const HASH = `sha256:${'a'.repeat(64)}`;
const binding = { hash: HASH, sampleId: 'sample-one', libraryRootId: 'root-one', relativePath: 'Drums/kick.wav' };

async function fixture() {
    const file = new File(['raw original'], 'kick.wav', { type: 'audio/wav' });
    const state = {
        roots: [{ id: 'root-one', provider: 'desktop', rootRef: '/granted/Samples', status: 'ready' }],
        samples: [
            {
                id: 'sample-one',
                libraryRootId: 'root-one',
                relativePath: 'Drums/kick.wav',
                displayName: 'kick',
                sync: { exists: true },
            },
        ],
    };
    const mappings = createLibraryAssetMappings();
    await mappings.remember(binding, () => true);
    const read = vi.fn(async () => ({ status: 'resolved' as const, provider: 'desktop' as const, file }));
    injectDependencies(resolveMappedLibraryAssetCandidate, {
        libraryStore: { value: state },
        mappings,
        resolveDroppedSampleFile: read,
    });
    return { state, mappings, read, file };
}

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('resolveMappedLibraryAssetCandidate', () => {
    it('reopens only the mapped known sample path through the existing file resolver', async () => {
        const { read, file } = await fixture();
        await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBe(file);
        expect(read).toHaveBeenCalledExactlyOnceWith({
            libraryRootId: 'root-one',
            relativePath: 'Drums/kick.wav',
            fallbackName: 'kick',
        });
    });

    it('returns no candidate for a different hash, offline root or changed sample path', async () => {
        const { state, read } = await fixture();
        await expect(
            resolveMappedLibraryAssetCandidate({ hash: `sha256:${'b'.repeat(64)}`, isCurrent: () => true })
        ).resolves.toBeNull();
        state.roots[0]!.status = 'offline';
        await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBeNull();
        state.roots[0]!.status = 'ready';
        state.samples[0]!.relativePath = 'Other/kick.wav';
        await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBeNull();
        expect(read).not.toHaveBeenCalled();
    });

    it('rejects traversal even when a corrupt local record repeats the stored path', async () => {
        const { state, mappings, read } = await fixture();
        for (const relativePath of ['../secret.wav', '/outside.wav', 'C:\\outside.wav', 'Drums/../secret.wav']) {
            state.samples[0]!.relativePath = relativePath;
            await mappings.remember({ ...binding, relativePath }, () => true);
            await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBeNull();
        }
        expect(read).not.toHaveBeenCalled();
    });

    it.each(['owner', 'root', 'path', 'permission'])('refuses a changed %s after a held file read', async (changed) => {
        const { state, read, file } = await fixture();
        const held = Promise.withResolvers<Awaited<ReturnType<typeof read>>>();
        const entered = Promise.withResolvers<void>();
        read.mockImplementation(() => {
            entered.resolve();
            return held.promise;
        });
        let current = true;
        const candidate = resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => current });
        await entered.promise;
        if (changed === 'owner') {
            current = false;
        } else if (changed === 'root') {
            state.roots[0]!.rootRef = '/replacement/Samples';
        } else if (changed === 'path') {
            state.samples[0]!.relativePath = 'Other/kick.wav';
        } else {
            state.roots[0]!.status = 'permission_required';
        }
        held.resolve({ status: 'resolved', provider: 'desktop', file });
        await expect(candidate).resolves.toBeNull();
    });

    it('uses existing browser handle reads and preserves revoked permission without prompting', async () => {
        const { state, mappings, file } = await fixture();
        const getFile = vi.fn(async () => file);
        const getFileHandle = vi.fn(async () => ({ getFile }));
        const getDirectoryHandle = vi.fn(async () => ({ getFileHandle }));
        const handle = { getDirectoryHandle, getFileHandle };
        const browserState = {
            ...state,
            roots: [{ id: 'root-one', provider: 'browser', rootRef: 'browser-root', status: 'ready', handle }],
        };
        injectDependencies(resolveMappedLibraryAssetCandidate, {
            libraryStore: { value: browserState },
            mappings,
            resolveDroppedSampleFile,
        });
        testOverrides.set(resolveDroppedSampleFile._deps.isNativeSampleLibraryRuntimeAvailable, () => false);
        testOverrides.set(resolveDroppedSampleFile._deps.readBrowserLibrarySampleFile, readBrowserLibrarySampleFile);
        await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBe(file);
        expect(getDirectoryHandle).toHaveBeenCalledWith('Drums');
        expect(getFileHandle).toHaveBeenCalledWith('kick.wav');
        getFile.mockRejectedValue(new DOMException('browser permission revoked', 'NotAllowedError'));
        await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBeNull();
    });

    it('turns revoked file permission and storage refusal into an honest miss', async () => {
        const { read } = await fixture();
        read.mockRejectedValue(new DOMException('permission revoked', 'NotAllowedError'));
        await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBeNull();
        vi.stubGlobal('indexedDB', undefined);
        await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBeNull();
    });

    it('uses the actual native path builder and its authorized reader refusal without inventing a path', async () => {
        const { state, mappings } = await fixture();
        const readNativeAudioFileBytes = vi.fn(async ({ path }: { path: string }) => {
            expect(path).toBe('/granted/Samples/Drums/kick.wav');
            return new Uint8Array([1, 2, 3]);
        });
        injectDependencies(resolveMappedLibraryAssetCandidate, {
            libraryStore: { value: state },
            mappings,
            resolveDroppedSampleFile,
        });
        testOverrides.set(resolveDroppedSampleFile._deps.isNativeSampleLibraryRuntimeAvailable, () => true);
        testOverrides.set(readNativeLibrarySampleFile._deps.readNativeAudioFileBytes, readNativeAudioFileBytes);
        const file = await resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true });
        expect(new Uint8Array(await file!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
        readNativeAudioFileBytes.mockRejectedValue(new Error('Path is outside allowed native file roots'));
        await expect(resolveMappedLibraryAssetCandidate({ hash: HASH, isCurrent: () => true })).resolves.toBeNull();
        expect(readNativeAudioFileBytes).toHaveBeenCalledTimes(2);
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { type LibraryRoot, type SampleRecord } from '../../../models/LibraryTypes';
import { type LibraryState } from '../../../stores/libraryStore';
import { scanBrowserDirectory } from '../scanBrowserDirectory';
import { setScanAbortController } from '../setScanAbortController';

const mocks = vi.hoisted(() => ({
    addSamples: vi.fn<(samples: SampleRecord[]) => void>(),
    buildFolderTree: vi.fn<(rootId: string) => void>(),
    libraryStore: { value: null as LibraryState | null },
    loggerError: vi.fn<(error: Error) => void>(),
    notifyUser: vi.fn<(message: string, type: 'error' | 'warning' | 'info' | 'success') => void>(),
    persistLibraryRoots: vi.fn<() => Promise<void>>(),
    persistSamples: vi.fn<() => Promise<void>>(),
    removeSamples: vi.fn<(sampleIds: string[]) => void>(),
    setScanProgress: vi.fn<(scanning: boolean, progress: number) => void>(),
    traverseBrowserDirectory: vi.fn(),
    updateLibraryRootStatus: vi.fn<(rootId: string, status: LibraryRoot['status'], fileCount?: number) => void>(),
}));

vi.mock('../traverseBrowserDirectory', () => ({
    traverseBrowserDirectory: (...args: unknown[]) => mocks.traverseBrowserDirectory(...args),
}));

vi.mock('../../../repositories/libraryPersistence/persistLibraryRoots', () => ({
    persistLibraryRoots: mocks.persistLibraryRoots,
}));

vi.mock('../../../repositories/libraryPersistence/persistSamples', () => ({
    persistSamples: mocks.persistSamples,
}));

vi.mock('../../../stores/libraryStore', () => ({
    addSamples: mocks.addSamples,
    get libraryStore() {
        return mocks.libraryStore;
    },
    removeSamples: mocks.removeSamples,
    setScanProgress: mocks.setScanProgress,
    updateLibraryRootStatus: mocks.updateLibraryRootStatus,
}));

vi.mock('../../buildFolderTree', () => ({
    buildFolderTree: mocks.buildFolderTree,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        error: mocks.loggerError,
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

function createLibraryState(samples: SampleRecord[] = []): LibraryState {
    return {
        activeRootId: null,
        currentFolder: null,
        favoritesOnly: false,
        folderTrees: {},
        roots: [],
        samples,
        scanProgress: 0,
        scanning: false,
        searchQuery: '',
        sortDirection: 'asc',
        sortField: 'name',
        tagFilter: null,
    };
}

function createBrowserRoot(overrides: Partial<LibraryRoot> = {}): LibraryRoot {
    return {
        connectedAt: 1,
        fileCount: 0,
        handle: {} as FileSystemDirectoryHandle,
        id: 'root-1',
        name: 'Samples',
        provider: 'browser',
        rootRef: 'browser-root-ref',
        settings: { recursive: true },
        status: 'scanning',
        ...overrides,
    };
}

describe('scanBrowserDirectory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setScanAbortController(null);
        mocks.libraryStore.value = createLibraryState();
        mocks.persistLibraryRoots.mockResolvedValue(undefined);
        mocks.persistSamples.mockResolvedValue(undefined);

        mocks.addSamples.mockImplementation((samples: SampleRecord[]) => {
            if (!mocks.libraryStore.value) {
                return;
            }
            const existingIds = new Set(mocks.libraryStore.value.samples.map((s) => s.id));
            const unique = samples.filter((s) => !existingIds.has(s.id));
            mocks.libraryStore.value = {
                ...mocks.libraryStore.value,
                samples: [...mocks.libraryStore.value.samples, ...unique],
            };
        });

        mocks.removeSamples.mockImplementation((sampleIds: string[]) => {
            if (!mocks.libraryStore.value) {
                return;
            }
            const toRemove = new Set(sampleIds);
            mocks.libraryStore.value = {
                ...mocks.libraryStore.value,
                samples: mocks.libraryStore.value.samples.filter((s) => !toRemove.has(s.id)),
            };
        });
    });

    afterEach(() => {
        setScanAbortController(null);
    });

    it('preserves favorite status of existing sample when mtime changes on rescan', async () => {
        const root = createBrowserRoot();
        const existingSample: SampleRecord = {
            id: 'root-1\u0000Drums/kick.wav',
            libraryRootId: 'root-1',
            relativePath: 'Drums/kick.wav',
            displayName: 'kick',
            ext: 'wav',
            folder: 'Drums',
            sync: { exists: true, status: 'indexed', mtimeMs: 1000 },
            format: {},
            tags: ['punchy'],
            favorite: true,
        };
        mocks.libraryStore.value = createLibraryState([existingSample]);

        mocks.traverseBrowserDirectory.mockImplementation(async function* () {
            yield {
                path: 'Drums/kick.wav',
                name: 'kick.wav',
                handle: {} as FileSystemFileHandle,
                mtimeMs: 2000,
            };
        });

        await scanBrowserDirectory(root);

        expect(mocks.persistSamples).toHaveBeenCalledTimes(1);
        expect(mocks.removeSamples).toHaveBeenCalledWith(['root-1\u0000Drums/kick.wav']);
        expect(mocks.addSamples).toHaveBeenCalledWith([
            expect.objectContaining({
                id: 'root-1\u0000Drums/kick.wav',
                favorite: true,
                tags: ['punchy'],
                sync: expect.objectContaining({ mtimeMs: 2000 }),
            }),
        ]);
        expect(mocks.libraryStore.value?.samples).toEqual([
            expect.objectContaining({
                id: 'root-1\u0000Drums/kick.wav',
                favorite: true,
                tags: ['punchy'],
                sync: expect.objectContaining({ mtimeMs: 2000 }),
            }),
        ]);
    });

    it('prunes removed sample file and persists deletion', async () => {
        const root = createBrowserRoot();
        const existingSample: SampleRecord = {
            id: 'root-1\u0000Drums/old.wav',
            libraryRootId: 'root-1',
            relativePath: 'Drums/old.wav',
            displayName: 'old',
            ext: 'wav',
            folder: 'Drums',
            sync: { exists: true, status: 'indexed', mtimeMs: 1000 },
            format: {},
            tags: [],
            favorite: false,
        };
        mocks.libraryStore.value = createLibraryState([existingSample]);

        mocks.traverseBrowserDirectory.mockImplementation(async function* () {});

        await scanBrowserDirectory(root);

        expect(mocks.removeSamples).toHaveBeenCalledWith(['root-1\u0000Drums/old.wav']);
        expect(mocks.persistSamples).toHaveBeenCalledTimes(1);
        expect(mocks.libraryStore.value?.samples).toEqual([]);
    });

    it('adds newly discovered sample with favorite=false', async () => {
        const root = createBrowserRoot();
        mocks.libraryStore.value = createLibraryState([]);

        mocks.traverseBrowserDirectory.mockImplementation(async function* () {
            yield {
                path: 'snare.wav',
                name: 'snare.wav',
                handle: {} as FileSystemFileHandle,
                mtimeMs: 1000,
            };
        });

        await scanBrowserDirectory(root);

        expect(mocks.addSamples).toHaveBeenCalledWith([
            expect.objectContaining({
                displayName: 'snare',
                relativePath: 'snare.wav',
                favorite: false,
            }),
        ]);
        expect(mocks.libraryStore.value?.samples).toEqual([
            expect.objectContaining({
                displayName: 'snare',
                relativePath: 'snare.wav',
                favorite: false,
            }),
        ]);
    });

    it('returns early when root handle is missing', async () => {
        const root = createBrowserRoot({ handle: undefined });

        await scanBrowserDirectory(root);

        expect(mocks.traverseBrowserDirectory).not.toHaveBeenCalled();
        expect(mocks.addSamples).not.toHaveBeenCalled();
        expect(mocks.persistSamples).not.toHaveBeenCalled();
    });

    it('handles scan errors and updates root status', async () => {
        const root = createBrowserRoot();
        mocks.traverseBrowserDirectory.mockImplementation(() => {
            throw new DOMException('denied', 'NotAllowedError');
        });

        await scanBrowserDirectory(root);

        expect(mocks.updateLibraryRootStatus).toHaveBeenCalledWith('root-1', 'permission_required');
        expect(notifyUser).toHaveBeenCalledWith(
            'Lost permission to read "Samples". Reconnect the folder to rescan.',
            'error'
        );
    });
});

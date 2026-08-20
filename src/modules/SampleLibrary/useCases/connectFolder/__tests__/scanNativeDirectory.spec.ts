import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { type LibraryRoot, type SampleRecord } from '../../../models/LibraryTypes';
import { readNativeDirectory } from '../../../repositories/readNativeDirectory';
import { type LibraryState } from '../../../stores/libraryStore';
import { scanNativeDirectory } from '../scanNativeDirectory';
import { setScanAbortController } from '../setScanAbortController';

type NativeDirectoryEntry = {
    name: string;
    isDirectory: boolean;
};

type ReadNativeDirectoryMock = ({ path }: { path: string }) => Promise<NativeDirectoryEntry[]>;

const mocks = vi.hoisted(() => ({
    addSamples: vi.fn<(samples: SampleRecord[]) => void>(),
    buildFolderTree: vi.fn<(rootId: string) => void>(),
    libraryStore: { value: null as LibraryState | null },
    loggerError: vi.fn<(error: Error) => void>(),
    notifyUser: vi.fn<(message: string, type: 'error' | 'warning' | 'info' | 'success') => void>(),
    persistLibraryRoots: vi.fn<() => Promise<void>>(),
    persistSamples: vi.fn<() => Promise<void>>(),
    readNativeDirectory: vi.fn<ReadNativeDirectoryMock>(),
    removeSamples: vi.fn<(sampleIds: string[]) => void>(),
    setScanProgress: vi.fn<(scanning: boolean, progress: number) => void>(),
    updateLibraryRootStatus: vi.fn<(rootId: string, status: LibraryRoot['status'], fileCount?: number) => void>(),
}));

vi.mock('../../../repositories/readNativeDirectory', () => ({
    readNativeDirectory: mocks.readNativeDirectory,
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

function createNativeRoot(overrides: Partial<LibraryRoot> = {}): LibraryRoot {
    return {
        connectedAt: 1,
        fileCount: 0,
        id: 'root-1',
        name: 'Samples',
        provider: 'desktop',
        rootRef: '/Users/jose/Samples',
        settings: { recursive: true },
        status: 'scanning',
        ...overrides,
    };
}

describe('scanNativeDirectory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setScanAbortController(null);
        mocks.libraryStore.value = createLibraryState();
        mocks.persistLibraryRoots.mockResolvedValue(undefined);
        mocks.persistSamples.mockResolvedValue(undefined);
    });

    afterEach(() => {
        setScanAbortController(null);
    });

    it('should scan native directories recursively through the repository reader', async () => {
        const root = createNativeRoot();
        mocks.readNativeDirectory.mockImplementation(async ({ path }) => {
            if (path === '/Users/jose/Samples') {
                return [
                    { name: 'Drums', isDirectory: true },
                    { name: 'notes.txt', isDirectory: false },
                ];
            }
            if (path === '/Users/jose/Samples/Drums') {
                return [
                    { name: 'kick.wav', isDirectory: false },
                    { name: 'Nested', isDirectory: true },
                ];
            }
            if (path === '/Users/jose/Samples/Drums/Nested') {
                return [{ name: 'snare.aiff', isDirectory: false }];
            }
            return [];
        });

        await scanNativeDirectory(root);

        expect(readNativeDirectory).toHaveBeenNthCalledWith(1, { path: '/Users/jose/Samples' });
        expect(readNativeDirectory).toHaveBeenNthCalledWith(2, { path: '/Users/jose/Samples/Drums' });
        expect(readNativeDirectory).toHaveBeenNthCalledWith(3, { path: '/Users/jose/Samples/Drums/Nested' });
        expect(mocks.addSamples).toHaveBeenCalledWith([
            expect.objectContaining({ displayName: 'kick', relativePath: 'Drums/kick.wav' }),
            expect.objectContaining({ displayName: 'snare', relativePath: 'Drums/Nested/snare.aiff' }),
        ]);
        expect(mocks.updateLibraryRootStatus).toHaveBeenCalledWith('root-1', 'ready', 2);
        expect(mocks.buildFolderTree).toHaveBeenCalledWith('root-1');
        expect(mocks.persistLibraryRoots).toHaveBeenCalledTimes(1);
        expect(mocks.persistSamples).toHaveBeenCalledTimes(1);
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('should classify a native root read failure instead of reporting the root ready', async () => {
        const root = createNativeRoot();
        mocks.readNativeDirectory.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));

        await scanNativeDirectory(root);

        expect(mocks.addSamples).not.toHaveBeenCalled();
        expect(mocks.buildFolderTree).not.toHaveBeenCalled();
        expect(mocks.persistLibraryRoots).not.toHaveBeenCalled();
        expect(mocks.persistSamples).not.toHaveBeenCalled();
        expect(mocks.updateLibraryRootStatus).toHaveBeenCalledTimes(1);
        expect(mocks.updateLibraryRootStatus).toHaveBeenCalledWith('root-1', 'permission_required');
        expect(notifyUser).toHaveBeenCalledWith(
            'Lost permission to read "Samples". Reconnect the folder to rescan.',
            'error'
        );
    });

    it('should warn and avoid pruning when a native subdirectory is unreadable', async () => {
        const root = createNativeRoot();
        const staleSkippedSample = {
            favorite: false,
            folder: 'Broken',
            format: {},
            id: 'root-1\u0000Broken/old.wav',
            libraryRootId: 'root-1',
            relativePath: 'Broken/old.wav',
            displayName: 'old',
            ext: 'wav',
            sync: { exists: true, status: 'discovered' },
            tags: [],
        } satisfies SampleRecord;
        mocks.libraryStore.value = createLibraryState([staleSkippedSample]);
        mocks.readNativeDirectory.mockImplementation(async ({ path }) => {
            if (path === '/Users/jose/Samples') {
                return [
                    { name: 'kick.wav', isDirectory: false },
                    { name: 'Broken', isDirectory: true },
                ];
            }
            if (path === '/Users/jose/Samples/Broken') {
                throw new DOMException('denied', 'NotAllowedError');
            }
            return [];
        });

        await scanNativeDirectory(root);

        expect(mocks.addSamples).toHaveBeenCalledWith([
            expect.objectContaining({ displayName: 'kick', relativePath: 'kick.wav' }),
        ]);
        expect(mocks.removeSamples).not.toHaveBeenCalled();
        expect(mocks.updateLibraryRootStatus).toHaveBeenCalledWith('root-1', 'ready', 1);
        expect(notifyUser).toHaveBeenCalledWith(
            'Scanned "Samples" but skipped 1 unreadable folder; some samples may be missing.',
            'warning'
        );
    });
});

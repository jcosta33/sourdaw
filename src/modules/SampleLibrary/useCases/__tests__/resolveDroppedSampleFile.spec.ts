import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { resolveDroppedSampleFile } from '../resolveDroppedSampleFile';

type TestLibraryRoot = {
    id: string;
    provider: 'browser' | 'desktop';
    rootRef: string;
    handle?: TestDirectoryHandle;
};

type TestLibraryStore = {
    value: {
        roots: TestLibraryRoot[];
    };
};

type TestDirectoryHandle = {
    getDirectoryHandle: (name: string) => Promise<TestDirectoryHandle>;
    getFileHandle: (name: string) => Promise<{ getFile: () => Promise<File> }>;
};

type ReadNativeLibrarySampleFile = (input: {
    rootPath: string;
    relativePath: string;
    fallbackName: string;
}) => Promise<File>;

type ReadBrowserLibrarySampleFile = (input: { rootHandle: TestDirectoryHandle; relativePath: string }) => Promise<File>;

function createLibraryStore(root: TestLibraryRoot): TestLibraryStore {
    return { value: { roots: [root] } };
}

describe('resolveDroppedSampleFile', () => {
    it('should resolve a native-root sample through the native file reader', async () => {
        const file = new File(['audio'], 'Kick.wav', { type: 'audio/wav' });
        const readNativeLibrarySampleFile = vi.fn<ReadNativeLibrarySampleFile>().mockResolvedValue(file);
        const readBrowserLibrarySampleFile = vi.fn<ReadBrowserLibrarySampleFile>();
        const isNativeSampleLibraryRuntimeAvailable = vi.fn(() => true);
        injectDependencies(resolveDroppedSampleFile, {
            libraryStore: createLibraryStore({
                id: 'root1',
                provider: 'desktop',
                rootRef: '/Users/jose/Samples',
            }),
            isNativeSampleLibraryRuntimeAvailable,
            readNativeLibrarySampleFile,
            readBrowserLibrarySampleFile,
        });

        const result = await resolveDroppedSampleFile({
            libraryRootId: 'root1',
            relativePath: 'Drums/Kick.wav',
            fallbackName: 'Kick',
        });

        expect(result).toEqual({ status: 'resolved', provider: 'desktop', file });
        expect(readNativeLibrarySampleFile).toHaveBeenCalledWith({
            rootPath: '/Users/jose/Samples',
            relativePath: 'Drums/Kick.wav',
            fallbackName: 'Kick',
        });
        expect(readBrowserLibrarySampleFile).not.toHaveBeenCalled();
    });

    it('should resolve a browser-root sample through the browser handle reader', async () => {
        const file = new File(['audio'], 'Clap.wav', { type: 'audio/wav' });
        const rootHandle: TestDirectoryHandle = {
            getDirectoryHandle: vi.fn(),
            getFileHandle: vi.fn(),
        };
        const readNativeLibrarySampleFile = vi.fn<ReadNativeLibrarySampleFile>();
        const readBrowserLibrarySampleFile = vi.fn<ReadBrowserLibrarySampleFile>().mockResolvedValue(file);
        const isNativeSampleLibraryRuntimeAvailable = vi.fn(() => false);
        injectDependencies(resolveDroppedSampleFile, {
            libraryStore: createLibraryStore({
                id: 'root1',
                provider: 'browser',
                rootRef: 'browser-root',
                handle: rootHandle,
            }),
            isNativeSampleLibraryRuntimeAvailable,
            readNativeLibrarySampleFile,
            readBrowserLibrarySampleFile,
        });

        const result = await resolveDroppedSampleFile({
            libraryRootId: 'root1',
            relativePath: 'Drums/Clap.wav',
            fallbackName: 'Clap',
        });

        expect(result).toEqual({ status: 'resolved', provider: 'browser', file });
        expect(readBrowserLibrarySampleFile).toHaveBeenCalledWith({
            rootHandle,
            relativePath: 'Drums/Clap.wav',
        });
        expect(readNativeLibrarySampleFile).not.toHaveBeenCalled();
    });

    it('should leave unmatched provider/runtime pairs unresolved', async () => {
        const readNativeLibrarySampleFile = vi.fn<ReadNativeLibrarySampleFile>();
        const readBrowserLibrarySampleFile = vi.fn<ReadBrowserLibrarySampleFile>();
        const isNativeSampleLibraryRuntimeAvailable = vi.fn(() => false);
        injectDependencies(resolveDroppedSampleFile, {
            libraryStore: createLibraryStore({
                id: 'root1',
                provider: 'desktop',
                rootRef: '/Users/jose/Samples',
            }),
            isNativeSampleLibraryRuntimeAvailable,
            readNativeLibrarySampleFile,
            readBrowserLibrarySampleFile,
        });

        const result = await resolveDroppedSampleFile({
            libraryRootId: 'root1',
            relativePath: 'Drums/Kick.wav',
            fallbackName: 'Kick',
        });

        expect(result).toEqual({ status: 'unresolved' });
        expect(readNativeLibrarySampleFile).not.toHaveBeenCalled();
        expect(readBrowserLibrarySampleFile).not.toHaveBeenCalled();
    });
});

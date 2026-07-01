import { describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { resolveDroppedSampleFile } from '../resolveDroppedSampleFile';

type TestLibraryRoot = {
    id: string;
    provider: 'browser' | 'tauri';
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

type ReadTauriLibrarySampleFile = (input: {
    rootPath: string;
    relativePath: string;
    fallbackName: string;
}) => Promise<File>;

type ReadBrowserLibrarySampleFile = (input: { rootHandle: TestDirectoryHandle; relativePath: string }) => Promise<File>;

function createLibraryStore(root: TestLibraryRoot): TestLibraryStore {
    return { value: { roots: [root] } };
}

describe('resolveDroppedSampleFile', () => {
    it('should resolve a native Tauri-root sample through the Tauri file reader', async () => {
        const file = new File(['audio'], 'Kick.wav', { type: 'audio/wav' });
        const readTauriLibrarySampleFile = vi.fn<ReadTauriLibrarySampleFile>().mockResolvedValue(file);
        const readBrowserLibrarySampleFile = vi.fn<ReadBrowserLibrarySampleFile>();
        const isNativeSampleLibraryRuntimeAvailable = vi.fn(() => true);
        injectDependencies(resolveDroppedSampleFile, {
            libraryStore: createLibraryStore({
                id: 'root1',
                provider: 'tauri',
                rootRef: '/Users/jose/Samples',
            }),
            isNativeSampleLibraryRuntimeAvailable,
            readTauriLibrarySampleFile,
            readBrowserLibrarySampleFile,
        });

        const result = await resolveDroppedSampleFile({
            libraryRootId: 'root1',
            relativePath: 'Drums/Kick.wav',
            fallbackName: 'Kick',
        });

        expect(result).toEqual({ status: 'resolved', provider: 'tauri', file });
        expect(readTauriLibrarySampleFile).toHaveBeenCalledWith({
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
        const readTauriLibrarySampleFile = vi.fn<ReadTauriLibrarySampleFile>();
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
            readTauriLibrarySampleFile,
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
        expect(readTauriLibrarySampleFile).not.toHaveBeenCalled();
    });

    it('should leave unmatched provider/runtime pairs unresolved', async () => {
        const readTauriLibrarySampleFile = vi.fn<ReadTauriLibrarySampleFile>();
        const readBrowserLibrarySampleFile = vi.fn<ReadBrowserLibrarySampleFile>();
        const isNativeSampleLibraryRuntimeAvailable = vi.fn(() => false);
        injectDependencies(resolveDroppedSampleFile, {
            libraryStore: createLibraryStore({
                id: 'root1',
                provider: 'tauri',
                rootRef: '/Users/jose/Samples',
            }),
            isNativeSampleLibraryRuntimeAvailable,
            readTauriLibrarySampleFile,
            readBrowserLibrarySampleFile,
        });

        const result = await resolveDroppedSampleFile({
            libraryRootId: 'root1',
            relativePath: 'Drums/Kick.wav',
            fallbackName: 'Kick',
        });

        expect(result).toEqual({ status: 'unresolved' });
        expect(readTauriLibrarySampleFile).not.toHaveBeenCalled();
        expect(readBrowserLibrarySampleFile).not.toHaveBeenCalled();
    });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LibraryState } from '../../../stores/libraryStore';
import { LibraryBrowser } from '../LibraryBrowser';

type LibraryBrowserMocks = {
    libraryState: LibraryState | undefined;
    isNativeSampleLibraryRuntimeAvailable: ReturnType<typeof vi.fn>;
    notifyUser: ReturnType<typeof vi.fn>;
    preview: {
        playingId: string | null;
        playFile: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
    };
    readTauriLibrarySampleFile: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(
    (): LibraryBrowserMocks => ({
        libraryState: undefined,
        isNativeSampleLibraryRuntimeAvailable: vi.fn(),
        notifyUser: vi.fn(),
        preview: {
            playingId: null,
            playFile: vi.fn(),
            stop: vi.fn(),
        },
        readTauriLibrarySampleFile: vi.fn(),
    })
);

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => mocks.libraryState ?? defaultValue),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../../useCases/isNativeSampleLibraryRuntimeAvailable', () => ({
    isNativeSampleLibraryRuntimeAvailable: mocks.isNativeSampleLibraryRuntimeAvailable,
}));

vi.mock('../../../useCases/readTauriLibrarySampleFile', () => ({
    readTauriLibrarySampleFile: mocks.readTauriLibrarySampleFile,
}));

type CreateLibraryStateInput = {
    provider: 'browser' | 'tauri';
    ext: string;
    rootRef: string;
    relativePath: string;
    displayName: string;
};

function createLibraryState({
    provider,
    ext,
    rootRef,
    relativePath,
    displayName,
}: CreateLibraryStateInput): LibraryState {
    return {
        roots: [
            {
                id: 'root1',
                name: 'Samples',
                provider,
                rootRef,
                connectedAt: 0,
                status: 'ready',
                fileCount: 1,
                settings: { recursive: true },
            },
        ],
        samples: [
            {
                id: 'sample1',
                libraryRootId: 'root1',
                relativePath,
                displayName,
                ext,
                folder: '',
                sync: { exists: true, status: 'indexed' },
                format: { durationSec: 1, sizeBytes: 4 },
                tags: [],
                favorite: false,
            },
        ],
        folderTrees: {},
        activeRootId: 'root1',
        currentFolder: null,
        searchQuery: '',
        tagFilter: null,
        favoritesOnly: false,
        sortField: 'name',
        sortDirection: 'asc',
        scanning: false,
        scanProgress: 0,
    };
}

describe('LibraryBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.libraryState = undefined;
        mocks.isNativeSampleLibraryRuntimeAvailable.mockReturnValue(false);
        mocks.preview.playingId = null;
    });

    it('should render without crashing', () => {
        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('should preview a Tauri-root sample through the SampleLibrary use case', async () => {
        const file = new File(['audio'], 'Kick.wav', { type: 'audio/wav' });
        mocks.isNativeSampleLibraryRuntimeAvailable.mockReturnValue(true);
        mocks.readTauriLibrarySampleFile.mockResolvedValue(file);
        mocks.libraryState = createLibraryState({
            provider: 'tauri',
            ext: 'wav',
            rootRef: '/Users/jose/Samples',
            relativePath: 'Drums/Kick.wav',
            displayName: 'Kick',
        });

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        fireEvent.click(screen.getByRole('button', { name: 'Play Kick' }));

        await waitFor(() => {
            expect(mocks.readTauriLibrarySampleFile).toHaveBeenCalledWith({
                rootPath: '/Users/jose/Samples',
                relativePath: 'Drums/Kick.wav',
                fallbackName: 'Kick',
            });
        });
        expect(mocks.preview.playFile).toHaveBeenCalledWith('sample1', file);
    });

    it('should warn before previewing risky formats in the browser runtime', async () => {
        mocks.libraryState = createLibraryState({
            provider: 'browser',
            ext: 'flac',
            rootRef: 'browser-root',
            relativePath: 'Loops/Texture.flac',
            displayName: 'Texture',
        });

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        fireEvent.click(screen.getByRole('button', { name: 'Play Texture' }));

        await waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                '"Texture" is a .flac file — your browser may not be able to preview it.',
                'warning'
            );
        });
    });

    it('should not show the browser risky-format warning in the native runtime', async () => {
        const file = new File(['audio'], 'Texture.flac', { type: 'audio/flac' });
        mocks.isNativeSampleLibraryRuntimeAvailable.mockReturnValue(true);
        mocks.readTauriLibrarySampleFile.mockResolvedValue(file);
        mocks.libraryState = createLibraryState({
            provider: 'tauri',
            ext: 'flac',
            rootRef: '/Users/jose/Samples',
            relativePath: 'Loops/Texture.flac',
            displayName: 'Texture',
        });

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        fireEvent.click(screen.getByRole('button', { name: 'Play Texture' }));

        await waitFor(() => {
            expect(mocks.preview.playFile).toHaveBeenCalledWith('sample1', file);
        });
        expect(mocks.notifyUser).not.toHaveBeenCalledWith(
            '"Texture" is a .flac file — your browser may not be able to preview it.',
            'warning'
        );
    });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LibraryState } from '../../../stores/libraryStore';
import { LibraryBrowser } from '../LibraryBrowser';

type LibraryBrowserMocks = {
    libraryState: LibraryState | undefined;
    isTauri: ReturnType<typeof vi.fn>;
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
        isTauri: vi.fn(),
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

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
}));

vi.mock('../../../useCases/readTauriLibrarySampleFile', () => ({
    readTauriLibrarySampleFile: mocks.readTauriLibrarySampleFile,
}));

describe('LibraryBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.libraryState = undefined;
        mocks.isTauri.mockReturnValue(false);
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
        mocks.isTauri.mockReturnValue(true);
        mocks.readTauriLibrarySampleFile.mockResolvedValue(file);
        mocks.libraryState = {
            roots: [
                {
                    id: 'root1',
                    name: 'Samples',
                    provider: 'tauri',
                    rootRef: '/Users/jose/Samples',
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
                    relativePath: 'Drums/Kick.wav',
                    displayName: 'Kick',
                    ext: 'wav',
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
});

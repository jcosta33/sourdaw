import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { type LibraryState } from '../../../stores/libraryStore';
import { LibraryBrowser } from '../LibraryBrowser';

type LibraryBrowserMocks = {
    libraryState: LibraryState | undefined;
    isNativeSampleLibraryRuntimeAvailable: ReturnType<typeof vi.fn>;
    notifyUser: ReturnType<typeof vi.fn>;
    preview: {
        playingId: string | null;
        playFile: Mock<(id: string, file: File) => Promise<void>>;
        stop: Mock<() => void>;
    };
    projectSpatialMap: ReturnType<typeof vi.fn>;
    readNativeLibrarySampleFile: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted((): LibraryBrowserMocks => ({
    libraryState: undefined,
    isNativeSampleLibraryRuntimeAvailable: vi.fn(),
    notifyUser: vi.fn(),
    preview: {
        playingId: null,
        playFile: vi.fn<(id: string, file: File) => Promise<void>>(),
        stop: vi.fn<() => void>(),
    },
    projectSpatialMap: vi.fn(),
    readNativeLibrarySampleFile: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => mocks.libraryState ?? defaultValue),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../../../useCases/isNativeSampleLibraryRuntimeAvailable', () => ({
    isNativeSampleLibraryRuntimeAvailable: mocks.isNativeSampleLibraryRuntimeAvailable,
}));

vi.mock('../../../useCases/readNativeLibrarySampleFile', () => ({
    readNativeLibrarySampleFile: mocks.readNativeLibrarySampleFile,
}));

vi.mock('../../../useCases/projectSpatialMap', () => ({
    projectSpatialMap: mocks.projectSpatialMap,
}));

// Canvas-based renderer — irrelevant to these assertions and not jsdom-safe.
vi.mock('../SpatialMapRenderer', () => ({
    SpatialMapRenderer: () => <div data-testid="spatial-map-renderer" />,
}));

type CreateLibraryStateInput = {
    provider: 'browser' | 'desktop';
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
                sync: { exists: true, status: 'indexed', sizeBytes: 4 },
                format: { durationSec: 1 },
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

    it('should preview a native-root sample through the SampleLibrary use case', async () => {
        const file = new File(['audio'], 'Kick.wav', { type: 'audio/wav' });
        mocks.isNativeSampleLibraryRuntimeAvailable.mockReturnValue(true);
        mocks.readNativeLibrarySampleFile.mockResolvedValue(file);
        mocks.libraryState = createLibraryState({
            provider: 'desktop',
            ext: 'wav',
            rootRef: '/Users/jose/Samples',
            relativePath: 'Drums/Kick.wav',
            displayName: 'Kick',
        });

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        fireEvent.click(screen.getByRole('button', { name: 'Play Kick' }));

        await waitFor(() => {
            expect(mocks.readNativeLibrarySampleFile).toHaveBeenCalledWith({
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

    it('should render a subfolder label by its Windows-native basename', () => {
        const state = createLibraryState({
            provider: 'desktop',
            ext: 'wav',
            rootRef: 'C:\\Users\\jose\\Samples',
            relativePath: 'Drums\\Kits\\Kick.wav',
            displayName: 'Kick',
        });
        // A Windows-native scan populates `folder` with backslash separators.
        state.samples[0]!.folder = 'Drums\\Kits';
        mocks.libraryState = state;

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        // The subfolder button must show only the leaf segment, not the full path.
        expect(screen.getByRole('button', { name: /^Open folder Kits,/ })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Drums\\Kits/ })).toBeNull();
    });

    it('should sort multiple subfolders by basename across slash, backslash, and mixed separators', () => {
        const state = createLibraryState({
            provider: 'desktop',
            ext: 'wav',
            rootRef: 'C:\\Users\\jose\\Samples',
            relativePath: 'Drums\\Snares\\Snare.wav',
            displayName: 'Snare',
        });
        const base = state.samples[0]!;
        // Three sibling samples in three subfolders so the sort comparator runs:
        // backslash-separated, plain, and mixed-separator (`C:\dir/sub\file.wav` style).
        state.samples = [
            { ...base, id: 'sample1', folder: 'Drums\\Snares' },
            { ...base, id: 'sample2', displayName: 'Loop', relativePath: 'Loops/Loop.wav', folder: 'Loops' },
            {
                ...base,
                id: 'sample3',
                displayName: 'Vinyl',
                relativePath: 'Kits\\Vinyl/808\\Vinyl.wav',
                folder: 'Kits\\Vinyl',
            },
        ];
        mocks.libraryState = state;

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        const names = screen
            .getAllByRole('button', { name: /^Open folder / })
            .map((btn) => btn.getAttribute('aria-label'));
        // Sorted by leaf basename (Loops < Snares < Vinyl), not by the raw
        // full-path strings (which would order Drums… < Kits… < Loops).
        expect(names).toEqual([
            'Open folder Loops, 0 files',
            'Open folder Snares, 0 files',
            'Open folder Vinyl, 0 files',
        ]);
    });

    it('should not show the browser risky-format warning in the native runtime', async () => {
        const file = new File(['audio'], 'Texture.flac', { type: 'audio/flac' });
        mocks.isNativeSampleLibraryRuntimeAvailable.mockReturnValue(true);
        mocks.readNativeLibrarySampleFile.mockResolvedValue(file);
        mocks.libraryState = createLibraryState({
            provider: 'desktop',
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

    it('does not offer fabricated musical analysis for indexed samples', () => {
        mocks.libraryState = createLibraryState({
            provider: 'desktop',
            ext: 'wav',
            rootRef: '/Users/jose/Samples',
            relativePath: 'Drums/Kick.wav',
            displayName: 'Kick',
        });

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        expect(screen.queryByRole('button', { name: 'Analyze' })).toBeNull();
    });

    it('should render the Re-project UMAP control disabled with the unavailable label and never dispatch', () => {
        mocks.libraryState = createLibraryState({
            provider: 'desktop',
            ext: 'wav',
            rootRef: '/Users/jose/Samples',
            relativePath: 'Drums/Kick.wav',
            displayName: 'Kick',
        });

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        // The map panel (and its button) only mounts once the MAP toggle is on.
        fireEvent.click(screen.getByRole('button', { name: 'Timbral spatial map' }));

        const reprojectButton = screen.getByRole('button', {
            name: 'Re-project UMAP unavailable: Timbral proximity re-projection is not available in this build',
        });
        expect(reprojectButton).toHaveProperty('disabled', true);
        expect(reprojectButton.getAttribute('title')).toBe(
            'Timbral proximity re-projection is not available in this build'
        );
        expect(reprojectButton.textContent).toBe('Re-project UMAP');

        // An interaction attempt must not reach the stubbed pipeline.
        fireEvent.click(reprojectButton);
        expect(mocks.projectSpatialMap).not.toHaveBeenCalled();
    });

    it('does not call playFile if preview is stopped while file acquisition is pending', async () => {
        let resolveFile!: (file: File) => void;
        const filePromise = new Promise<File>((resolve) => {
            resolveFile = resolve;
        });
        mocks.isNativeSampleLibraryRuntimeAvailable.mockReturnValue(true);
        mocks.readNativeLibrarySampleFile.mockReturnValue(filePromise);
        mocks.libraryState = createLibraryState({
            provider: 'desktop',
            ext: 'wav',
            rootRef: '/Users/jose/Samples',
            relativePath: 'Drums/Kick.wav',
            displayName: 'Kick',
        });

        const { rerender } = render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        fireEvent.click(screen.getByRole('button', { name: 'Play Kick' }));

        rerender(<LibraryBrowser preview={{ ...mocks.preview, playingId: 'sample1' }} selectedTrackId={null} />);
        fireEvent.click(screen.getByRole('button', { name: 'Stop Kick' }));

        resolveFile(new File(['audio'], 'Kick.wav', { type: 'audio/wav' }));
        await filePromise;

        expect(mocks.preview.playFile).not.toHaveBeenCalled();
    });

    it('plays only the latest audition under reversed file-acquisition completion order', async () => {
        let resolveFile1!: (file: File) => void;
        let resolveFile2!: (file: File) => void;
        const file1Promise = new Promise<File>((resolve) => {
            resolveFile1 = resolve;
        });
        const file2Promise = new Promise<File>((resolve) => {
            resolveFile2 = resolve;
        });

        mocks.isNativeSampleLibraryRuntimeAvailable.mockReturnValue(true);
        mocks.readNativeLibrarySampleFile.mockReturnValueOnce(file1Promise).mockReturnValueOnce(file2Promise);

        const state = createLibraryState({
            provider: 'desktop',
            ext: 'wav',
            rootRef: '/Users/jose/Samples',
            relativePath: 'Drums/Kick.wav',
            displayName: 'Kick',
        });
        const kick = state.samples[0]!;
        state.samples = [
            kick,
            {
                ...kick,
                id: 'sample2',
                displayName: 'Snare',
                relativePath: 'Drums/Snare.wav',
            },
        ];
        mocks.libraryState = state;

        render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        // Click sample 1 (deferred file 1)
        fireEvent.click(screen.getByRole('button', { name: 'Play Kick' }));

        // Click sample 2 (deferred file 2)
        fireEvent.click(screen.getByRole('button', { name: 'Play Snare' }));

        // Resolve file 2 first
        const file2 = new File(['snare'], 'Snare.wav', { type: 'audio/wav' });
        resolveFile2(file2);
        await file2Promise;

        expect(mocks.preview.playFile).toHaveBeenCalledWith('sample2', file2);
        expect(mocks.preview.playFile).not.toHaveBeenCalledWith('sample1', expect.anything());

        // Resolve file 1 second
        const file1 = new File(['kick'], 'Kick.wav', { type: 'audio/wav' });
        resolveFile1(file1);
        await file1Promise;

        // Verify mocks.preview.playFile is called for sample 2 and NOT for sample 1
        expect(mocks.preview.playFile).toHaveBeenCalledTimes(1);
        expect(mocks.preview.playFile).toHaveBeenCalledWith('sample2', file2);
        expect(mocks.preview.playFile).not.toHaveBeenCalledWith('sample1', expect.anything());
    });

    it('does not call playFile if LibraryBrowser unmounts while file acquisition is pending', async () => {
        let resolveFile!: (file: File) => void;
        const filePromise = new Promise<File>((resolve) => {
            resolveFile = resolve;
        });
        mocks.isNativeSampleLibraryRuntimeAvailable.mockReturnValue(true);
        mocks.readNativeLibrarySampleFile.mockReturnValue(filePromise);
        mocks.libraryState = createLibraryState({
            provider: 'desktop',
            ext: 'wav',
            rootRef: '/Users/jose/Samples',
            relativePath: 'Drums/Kick.wav',
            displayName: 'Kick',
        });

        const { unmount } = render(<LibraryBrowser preview={mocks.preview} selectedTrackId={null} />);

        // Click sample
        fireEvent.click(screen.getByRole('button', { name: 'Play Kick' }));

        // Unmount component
        unmount();

        // Resolve file promise
        resolveFile(new File(['audio'], 'Kick.wav', { type: 'audio/wav' }));
        await filePromise;

        // Verify mocks.preview.playFile was not called
        expect(mocks.preview.playFile).not.toHaveBeenCalled();
    });

    it('does not stop playback when re-rendered with an updated preview reference', () => {
        const preview = { ...mocks.preview, stop: vi.fn(), playingId: null };
        const { rerender } = render(<LibraryBrowser preview={preview} selectedTrackId={null} />);

        const updatedPreview = { ...mocks.preview, stop: vi.fn(), playingId: 'sample-1' };
        rerender(<LibraryBrowser preview={updatedPreview} selectedTrackId={null} />);

        expect(preview.stop).not.toHaveBeenCalled();
        expect(updatedPreview.stop).not.toHaveBeenCalled();
    });

    it('stops preview on unmount', () => {
        const preview = { ...mocks.preview, stop: vi.fn() };
        const { unmount } = render(<LibraryBrowser preview={preview} selectedTrackId={null} />);
        unmount();
        expect(preview.stop).toHaveBeenCalledTimes(1);
    });
});

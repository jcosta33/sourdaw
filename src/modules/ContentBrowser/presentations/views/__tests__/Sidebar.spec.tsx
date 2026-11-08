import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { decodeAudioFile } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { Sidebar } from '../Sidebar';

type DecodeAudioFileFn = typeof import('#/modules/AudioEngine/useCases').decodeAudioFile;
type ImportedSampleDecodeHold = NonNullable<Parameters<DecodeAudioFileFn>[1]>;

// Mock hooks
vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [],
        selectedTrackId: null,
    })),
}));

vi.mock('../../hooks/usePreviewAudio', () => ({
    usePreviewAudio: vi.fn(() => ({
        play: vi.fn(),
        stop: vi.fn(),
    })),
}));

const mockPlatformPlugins = [
    {
        id: 'p1',
        name: 'Reverb Hall',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        parameters: [],
        hasCustomUI: false,
    },
    {
        id: 'p2',
        name: 'Delay Line',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'effect',
        parameters: [],
        hasCustomUI: false,
    },
    {
        id: 'p3',
        name: 'Grain Synth',
        vendor: 'Sourdaw',
        format: 'builtin',
        category: 'instrument',
        parameters: [],
        hasCustomUI: false,
    },
];

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getPlatformPlugins: vi.fn(() => mockPlatformPlugins),
}));
// Mock child components
vi.mock('../Sidebar/InstrumentsTab', () => ({
    InstrumentsTab: ({
        favorites,
        onToggleFavorite,
    }: {
        favorites: Set<unknown>;
        onToggleFavorite: (id: string) => void;
    }) => (
        <div
            data-testid="instruments-tab"
            data-favorites={Array.from(favorites, (favorite) => String(favorite)).join('|')}
        >
            Instruments
            <button type="button" onClick={() => onToggleFavorite('instrument-1')}>
                toggle favorite
            </button>
        </div>
    ),
}));

vi.mock('../Sidebar/EffectsTab', () => ({
    EffectsTab: ({ plugins }: { plugins: { name: string }[] }) => (
        <div data-testid="effects-tab" data-plugin-names={plugins.map((plugin) => plugin.name).join('|')}>
            Effects
        </div>
    ),
}));

vi.mock('../Sidebar/SamplesTab', () => ({
    SamplesTab: () => <div data-testid="samples-tab">Samples</div>,
}));

vi.mock('../Sidebar/MacrosPanel', () => ({
    MacrosPanel: () => <div data-testid="macros-panel">Macros</div>,
}));

vi.mock('#/modules/SampleLibrary/presentations/views', () => ({
    LibraryBrowser: () => <div data-testid="library-browser">Library Browser</div>,
}));

const holdLifecycle = vi.hoisted(() => ({ released: false }));

const audioEngineMocks = vi.hoisted(() => {
    const decodeImportedFile = async (
        file: File,
        residencyHold?: ImportedSampleDecodeHold
    ): Promise<{ id: string; buffer: { duration: number } }> => {
        const id = `buffer-${file.name}`;
        residencyHold?.retain(id);
        return { id, buffer: { duration: 1.5 } };
    };
    const hold: ImportedSampleDecodeHold = {
        release: vi.fn(() => {
            holdLifecycle.released = true;
        }),
        retain: vi.fn((_id: string) => {
            if (holdLifecycle.released) {
                throw new Error('An audio buffer residency hold cannot retain after its release.');
            }
        }),
    };
    const openCachedAudioBufferHold = vi.fn(() => hold);
    const decodeAudioFileMock = vi.fn(decodeImportedFile);
    return { hold, openCachedAudioBufferHold, decodeAudioFileMock, decodeImportedFile };
});

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFile: audioEngineMocks.decodeAudioFileMock,
    openCachedAudioBufferHold: audioEngineMocks.openCachedAudioBufferHold,
}));

describe('Sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        holdLifecycle.released = false;
        audioEngineMocks.decodeAudioFileMock.mockImplementation(audioEngineMocks.decodeImportedFile);
    });

    it('should render Instruments tab by default', () => {
        render(<Sidebar />);
        expect(screen.getByTestId('instruments-tab')).toBeInTheDocument();
    });

    it('should expose the sections as tabs that control a panel labelled by the selected tab', () => {
        render(<Sidebar />);

        const tablist = screen.getByRole('tablist', { name: 'Browser sections' });
        expect(
            within(tablist)
                .getAllByRole('tab')
                .map((tab) => tab.textContent)
        ).toEqual(['Instruments', 'Effects', 'Library', 'Macros', 'Project']);
        const instruments = screen.getByRole('tab', { name: 'Instruments' });
        expect(instruments).toHaveAttribute('aria-selected', 'true');
        expect(instruments).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('tab', { name: 'Effects' })).toHaveAttribute('tabindex', '-1');

        const panel = screen.getByRole('tabpanel', { name: 'Instruments' });
        expect(instruments).toHaveAttribute('aria-controls', panel.id);

        fireEvent.click(screen.getByRole('tab', { name: 'Effects' }));
        expect(screen.getByRole('tabpanel', { name: 'Effects' })).toBeInTheDocument();
    });

    it('should move focus between sections with the arrow keys and select on activation only', () => {
        render(<Sidebar />);
        screen.getByRole('tab', { name: 'Instruments' }).focus();

        fireEvent.keyDown(screen.getByRole('tab', { name: 'Instruments' }), { key: 'ArrowRight' });

        expect(screen.getByRole('tab', { name: 'Effects' })).toHaveFocus();
        expect(screen.getByRole('tab', { name: 'Instruments' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByTestId('effects-tab')).not.toBeInTheDocument();
    });

    it('should expose the Library sub-sections as their own named tablist', () => {
        render(<Sidebar />);
        fireEvent.click(screen.getByRole('tab', { name: 'Library' }));

        const subTabs = within(screen.getByRole('tablist', { name: 'Library sections' })).getAllByRole('tab');
        expect(subTabs.map((tab) => tab.textContent)).toEqual(['Folders', 'Imported', 'Find']);
        expect(screen.getByRole('tab', { name: 'Folders' })).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(screen.getByRole('tab', { name: 'Imported' }));
        expect(screen.getByRole('tab', { name: 'Imported' })).toHaveAttribute('aria-selected', 'true');
    });

    it('should drop malformed stored favorite entries before tab props receive favorites', () => {
        window.localStorage.setItem(
            'sourdaw-favorites',
            JSON.stringify(['valid-favorite', 42, null, { id: 'object-favorite' }, false])
        );

        render(<Sidebar />);

        expect(screen.getByTestId('instruments-tab')).toHaveAttribute('data-favorites', 'valid-favorite');
    });

    it('should switch to Effects tab when clicked', () => {
        render(<Sidebar />);
        const effectsButton = screen.getByText('Effects');
        fireEvent.click(effectsButton);
        expect(screen.getByTestId('effects-tab')).toBeInTheDocument();
    });

    it('should switch to Library tab when clicked', () => {
        render(<Sidebar />);
        const libraryButton = screen.getByText('Library');
        fireEvent.click(libraryButton);
        expect(screen.getByTestId('library-browser')).toBeInTheDocument();
    });

    it('should switch to Macros tab when clicked', () => {
        render(<Sidebar />);
        const macrosButton = screen.getByText('Macros');
        fireEvent.click(macrosButton);
        expect(screen.getByTestId('macros-panel')).toBeInTheDocument();
    });

    it('should show search input', () => {
        render(<Sidebar />);
        expect(screen.getByPlaceholderText(/Search/)).toBeInTheDocument();
    });

    it('should filter effects tab plugins by the search query, case-insensitively against the plugin name', () => {
        render(<Sidebar />);
        fireEvent.click(screen.getByText('Effects'));

        const searchInput = screen.getByPlaceholderText(/Search/);
        fireEvent.change(searchInput, { target: { value: 'REVERB' } });

        expect(screen.getByTestId('effects-tab')).toHaveAttribute('data-plugin-names', 'Reverb Hall');
    });

    it('should pass through all platform plugins to the effects tab when the search query is blank', () => {
        render(<Sidebar />);
        fireEvent.click(screen.getByText('Effects'));

        expect(screen.getByTestId('effects-tab')).toHaveAttribute(
            'data-plugin-names',
            'Reverb Hall|Delay Line|Grain Synth'
        );
    });

    it('should persist a toggled favorite under the sourdaw-favorites storage key', () => {
        render(<Sidebar />);

        fireEvent.click(screen.getByText('toggle favorite'));

        expect(window.localStorage.getItem('sourdaw-favorites')).toBe('["instrument-1"]');
    });

    it('should remove a favorite from the sourdaw-favorites storage key when toggled again', () => {
        render(<Sidebar />);

        fireEvent.click(screen.getByText('toggle favorite'));
        fireEvent.click(screen.getByText('toggle favorite'));

        expect(window.localStorage.getItem('sourdaw-favorites')).toBe('[]');
    });

    it('should import .opus and .wave files through the canonical audio-extension law', async () => {
        render(<Sidebar />);
        fireEvent.click(screen.getByText('Library'));
        fireEvent.click(screen.getByText('Imported'));

        const fileInput = document.querySelector('input[type="file"]');
        if (!fileInput) {
            throw new Error('Expected the Imported tab to render a file input');
        }

        // The picker hint is derived from the same extension law as the import
        // guard, so it must advertise the extensions the old hardcoded list missed.
        expect(fileInput).toHaveAttribute('accept', expect.stringContaining('.opus'));
        expect(fileInput).toHaveAttribute('accept', expect.stringContaining('.wave'));

        // Non-audio MIME types on purpose: acceptance must hinge on the file
        // extension alone, which is the branch the drifted inline list broke.
        const opus = new File([new Uint8Array([0])], 'beat.opus', { type: 'application/octet-stream' });
        const wave = new File([new Uint8Array([0])], 'loop.wave', { type: 'application/octet-stream' });
        const rejected = new File([new Uint8Array([0])], 'notes.txt', { type: 'text/plain' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [opus, wave, rejected] } });
        });

        expect(decodeAudioFile).toHaveBeenCalledTimes(2);
        expect(decodeAudioFile).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'beat.opus' }),
            audioEngineMocks.hold
        );
        expect(decodeAudioFile).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'loop.wave' }),
            audioEngineMocks.hold
        );
        expect(decodeAudioFile).not.toHaveBeenCalledWith(
            expect.objectContaining({ name: 'notes.txt' }),
            expect.anything()
        );
        await waitFor(() => expect(screen.getByText('2 samples')).toBeInTheDocument());
    });

    it('stops a multi-file import after unmount without opening another hold or notifying', async () => {
        let finishFast!: () => void;
        const unmountAfterFastRetain: { fn: () => void } = { fn: () => {} };
        const fastDone = new Promise<void>((resolve) => {
            finishFast = resolve;
        });

        const { unmount } = render(<Sidebar />);
        unmountAfterFastRetain.fn = unmount;

        audioEngineMocks.decodeAudioFileMock.mockImplementation(async (file, residencyHold) => {
            if (file.name === 'fast.opus') {
                await fastDone;
                const decoded = await audioEngineMocks.decodeImportedFile(file, residencyHold);
                unmountAfterFastRetain.fn();
                return decoded;
            }
            throw new Error('Expected the import loop to stop before decoding another file after unmount');
        });

        fireEvent.click(screen.getByText('Library'));
        fireEvent.click(screen.getByText('Imported'));

        const fileInput = document.querySelector('input[type="file"]');
        if (!fileInput) {
            throw new Error('Expected the Imported tab to render a file input');
        }

        const fast = new File([new Uint8Array([0])], 'fast.opus', { type: 'application/octet-stream' });
        const after = new File([new Uint8Array([0])], 'after.opus', { type: 'application/octet-stream' });

        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [fast, after] } });
        });
        await waitFor(() => expect(decodeAudioFile).toHaveBeenCalledTimes(1));
        await act(async () => {
            finishFast();
            await Promise.resolve();
        });

        expect(audioEngineMocks.openCachedAudioBufferHold).toHaveBeenCalledTimes(1);
        expect(decodeAudioFile).toHaveBeenCalledTimes(1);
        expect(decodeAudioFile).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'fast.opus' }),
            audioEngineMocks.hold
        );
        expect(decodeAudioFile).not.toHaveBeenCalledWith(
            expect.objectContaining({ name: 'after.opus' }),
            expect.anything()
        );
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();

        holdLifecycle.released = false;
        vi.mocked(decodeAudioFile).mockClear();
        vi.mocked(notifyUser).mockClear();
        audioEngineMocks.hold.retain.mockClear();
        audioEngineMocks.hold.release.mockClear();
        audioEngineMocks.openCachedAudioBufferHold.mockClear();

        let releaseInFlight!: () => void;
        const inFlightGate = new Promise<void>((resolve) => {
            releaseInFlight = resolve;
        });

        audioEngineMocks.decodeAudioFileMock.mockImplementation(async (file, residencyHold) => {
            if (file.name === 'pending.opus') {
                await inFlightGate;
            }
            return audioEngineMocks.decodeImportedFile(file, residencyHold);
        });

        const { unmount: unmountDuringDecode } = render(<Sidebar />);
        fireEvent.click(screen.getByText('Library'));
        fireEvent.click(screen.getByText('Imported'));

        const inFlightInput = document.querySelector('input[type="file"]');
        if (!inFlightInput) {
            throw new Error('Expected the Imported tab to render a file input');
        }

        const pending = new File([new Uint8Array([0])], 'pending.opus', { type: 'application/octet-stream' });

        await act(async () => {
            fireEvent.change(inFlightInput, { target: { files: [pending, after] } });
        });
        await waitFor(() => expect(decodeAudioFile).toHaveBeenCalledTimes(1));
        unmountDuringDecode();
        await act(async () => {
            releaseInFlight();
            await Promise.resolve();
        });

        expect(audioEngineMocks.openCachedAudioBufferHold).toHaveBeenCalledTimes(1);
        expect(decodeAudioFile).toHaveBeenCalledTimes(1);
        expect(audioEngineMocks.hold.retain).toHaveBeenCalledWith('buffer-pending.opus');
        expect(vi.mocked(notifyUser)).not.toHaveBeenCalled();
    });
});

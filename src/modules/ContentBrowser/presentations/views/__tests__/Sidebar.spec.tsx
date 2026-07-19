import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Sidebar } from '../Sidebar';

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

describe('Sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
    });

    it('should render Instruments tab by default', () => {
        render(<Sidebar />);
        expect(screen.getByTestId('instruments-tab')).toBeInTheDocument();
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
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';

// Mock hooks
vi.mock('../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [],
        selectedTrackId: null,
    })),
}));

vi.mock('../hooks/usePreviewAudio', () => ({
    usePreviewAudio: vi.fn(() => ({
        play: vi.fn(),
        stop: vi.fn(),
    })),
}));

// Mock child components
vi.mock('./Sidebar/InstrumentsTab', () => ({
    InstrumentsTab: () => <div data-testid="instruments-tab">Instruments</div>,
}));

vi.mock('./Sidebar/EffectsTab', () => ({
    EffectsTab: () => <div data-testid="effects-tab">Effects</div>,
}));

vi.mock('./Sidebar/SamplesTab', () => ({
    SamplesTab: () => <div data-testid="samples-tab">Samples</div>,
}));

vi.mock('./Sidebar/MacrosPanel', () => ({
    MacrosPanel: () => <div data-testid="macros-panel">Macros</div>,
}));

vi.mock('#/modules/SampleLibrary/presentations/views/LibraryBrowser', () => ({
    LibraryBrowser: () => <div data-testid="library-browser">Library Browser</div>,
}));

describe('Sidebar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render Instruments tab by default', () => {
        render(<Sidebar />);
        expect(screen.getByTestId('instruments-tab')).toBeInTheDocument();
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
});

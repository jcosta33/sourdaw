import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { AutomationView } from './AutomationView';
import { useTracks } from '../hooks/useTracks';

// Mock hooks
vi.mock('../hooks/useTracks', () => ({
    useTracks: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

// Mock child components using exact paths from the component
vi.mock('#/modules/Arrangement/presentations/views/ArrangementBar', () => ({
    ArrangementBar: () => <div data-testid="arrangement-bar">Arrangement Bar</div>,
}));

vi.mock('./AutomationView/TrackAutomationSection', () => ({
    TrackAutomationSection: ({ trackId, trackName }: any) => <div data-testid={`track-section-${trackId}`}>{trackName}</div>,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick, 'aria-label': ariaLabel }: any) => (
        <button onClick={onClick} aria-label={ariaLabel}>{children}</button>
    ),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('AutomationView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useTracks).mockReturnValue({
            tracks: [],
        } as any);
    });

    it('should render correctly', () => {
        const { container } = renderWithTooltip(<AutomationView />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render arrangement bar', () => {
        renderWithTooltip(<AutomationView />);
        expect(screen.getByTestId('arrangement-bar')).toBeInTheDocument();
    });

    it('should render track sections when tracks exist', () => {
        vi.mocked(useTracks).mockReturnValue({
            tracks: [
                { id: 'track-1', name: 'Track 1', kind: 'audio', clips: [], devices: [] },
                { id: 'track-2', name: 'Track 2', kind: 'midi', clips: [], devices: [] },
            ],
        } as any);

        renderWithTooltip(<AutomationView />);
        expect(screen.getByTestId('track-section-track-1')).toBeInTheDocument();
        expect(screen.getByTestId('track-section-track-2')).toBeInTheDocument();
    });
});

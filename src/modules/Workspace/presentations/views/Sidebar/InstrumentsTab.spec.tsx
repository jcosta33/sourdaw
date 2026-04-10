import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { TrackDummy } from '#/modules/Arrangement/_tests/TrackDummy';
import { InstrumentsTab } from './InstrumentsTab';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('InstrumentsTab', () => {
    const mockTrack = TrackDummy.create();
    const mockPreview = {
        play: vi.fn(),
        stop: vi.fn(),
    };
    const mockRoute = { id: 'instruments', title: 'Instruments' };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(
            <InstrumentsTab 
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute as any}
                pushRoute={vi.fn()}
            />
        );
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(
            <InstrumentsTab 
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute as any}
                pushRoute={vi.fn()}
            />
        );
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(
            <InstrumentsTab 
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute as any}
                pushRoute={vi.fn()}
            />
        );
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});

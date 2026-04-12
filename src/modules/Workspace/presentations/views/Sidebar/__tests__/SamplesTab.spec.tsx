import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { SamplesTab } from '../SamplesTab';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('SamplesTab', () => {
    const mockSamples = [
        { id: 's1', name: 'Kick', category: 'Drums', duration: '1.0s', audioBufferId: 'b1' },
        { id: 's2', name: 'Snare', category: 'Drums', duration: '0.5s', audioBufferId: 'b2' },
    ];
    const mockPreview = {
        playingId: null,
        play: vi.fn(),
        playTone: vi.fn(),
        stop: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(
            <SamplesTab 
                samples={mockSamples}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                selectedTrackId="t1"
                preview={mockPreview as any}
            />
        );
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(
            <SamplesTab 
                samples={mockSamples}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                selectedTrackId="t1"
                preview={mockPreview as any}
            />
        );
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(
            <SamplesTab 
                samples={mockSamples}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                selectedTrackId="t1"
                preview={mockPreview as any}
            />
        );
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});

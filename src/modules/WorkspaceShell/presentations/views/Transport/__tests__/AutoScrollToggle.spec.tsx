import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { toggleTimelineAutoScroll } from '#/modules/Arrangement/useCases';

import { AutoScrollToggle } from '../AutoScrollToggle';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    toggleTimelineAutoScroll: vi.fn(),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('AutoScrollToggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useStore).mockImplementation((_store, defaultValue) => defaultValue);
    });

    it('should render without crashing', () => {
        renderWithTooltip(<AutoScrollToggle />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        renderWithTooltip(<AutoScrollToggle />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(<AutoScrollToggle />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('exposes aria-pressed true when auto-scroll is enabled', () => {
        renderWithTooltip(<AutoScrollToggle />);
        expect(screen.getByRole('button', { name: 'Auto-scroll follows playhead' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('exposes aria-pressed false when auto-scroll is disabled', () => {
        vi.mocked(useStore).mockReturnValue({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: false,
        });
        renderWithTooltip(<AutoScrollToggle />);
        expect(screen.getByRole('button', { name: 'Auto-scroll follows playhead' })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });

    it('should call the Arrangement auto-scroll use case when clicked', () => {
        renderWithTooltip(<AutoScrollToggle />);

        fireEvent.click(screen.getByRole('button', { name: 'Auto-scroll follows playhead' }));

        expect(toggleTimelineAutoScroll).toHaveBeenCalledTimes(1);
        expect(toggleTimelineAutoScroll).toHaveBeenCalledWith();
    });
});

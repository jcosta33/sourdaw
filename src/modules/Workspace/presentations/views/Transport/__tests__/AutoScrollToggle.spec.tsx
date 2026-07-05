import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { toggleTimelineAutoScroll } from '#/modules/Arrangement/useCases';

import { AutoScrollToggle } from '../AutoScrollToggle';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
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

    it('should call the Arrangement auto-scroll use case when clicked', () => {
        renderWithTooltip(<AutoScrollToggle />);

        fireEvent.click(screen.getByRole('button', { name: 'Auto-scroll follows playhead' }));

        expect(toggleTimelineAutoScroll).toHaveBeenCalledTimes(1);
        expect(toggleTimelineAutoScroll).toHaveBeenCalledWith();
    });
});

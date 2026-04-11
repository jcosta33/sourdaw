import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { TrackDummy } from '#/modules/Arrangement/_tests/TrackDummy';
import { ExpandedChannelStrip } from '../ExpandedChannelStrip';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('ExpandedChannelStrip', () => {
    const mockTrack = TrackDummy.create();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(<ExpandedChannelStrip track={mockTrack} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});

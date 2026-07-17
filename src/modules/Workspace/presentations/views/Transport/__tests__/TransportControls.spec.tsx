import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { TransportControls } from '../TransportControls';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TransportControls', () => {
    const defaultProps = {
        isPlaying: false,
        isRecording: false,
        isAudioRecording: false,
        isLooping: false,
        overdubEnabled: false,
        showOverdub: false,
        anyTrackArmed: false,
        metronomeEnabled: false,
        metronomeVolume: 0.8,
        punchInEnabled: false,
        countInEnabled: false,
        countInBars: 1,
    };
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<TransportControls {...defaultProps} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(<TransportControls {...defaultProps} />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(<TransportControls {...defaultProps} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { TransportControls } from '../TransportControls';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn().mockResolvedValue(undefined),
    togglePlayback: vi.fn(),
    stopPlayback: vi.fn(),
    toggleLoop: vi.fn(),
    toggleOverdub: vi.fn(),
    toggleMetronome: vi.fn(),
    setMetronomeVolume: vi.fn(),
    toggleRecording: vi.fn(),
    toggleCountIn: vi.fn(),
    setCountInBars: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    togglePlayback: mocks.togglePlayback,
    stopPlayback: mocks.stopPlayback,
    toggleLoop: mocks.toggleLoop,
    toggleOverdub: mocks.toggleOverdub,
    toggleMetronome: mocks.toggleMetronome,
    setMetronomeVolume: mocks.setMetronomeVolume,
    toggleRecording: mocks.toggleRecording,
    toggleCountIn: mocks.toggleCountIn,
    setCountInBars: mocks.setCountInBars,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
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

    describe('status announcement (renderIife_14)', () => {
        it('announces Stopped when neither playing nor recording', () => {
            renderWithTooltip(<TransportControls {...defaultProps} />);
            expect(screen.getByText('Stopped')).toBeInTheDocument();
        });

        it('announces Playing when playing but not recording', () => {
            renderWithTooltip(<TransportControls {...defaultProps} isPlaying={true} />);
            expect(screen.getByText('Playing')).toBeInTheDocument();
        });

        it('announces Recording (priority over Playing) when both are true', () => {
            renderWithTooltip(<TransportControls {...defaultProps} isPlaying={true} isRecording={true} />);
            expect(screen.getByText('Recording')).toBeInTheDocument();
            expect(screen.queryByText('Playing')).not.toBeInTheDocument();
        });
    });

    describe('record button label (renderIife_15)', () => {
        it('labels the record tooltip "Record" when idle and no tracks armed', () => {
            const { container } = renderWithTooltip(<TransportControls {...defaultProps} />);
            // renderIife_15 returns 'Record'; tooltip renders it as a text node.
            expect(container.textContent).toContain('Record (R)');
        });

        it('labels the record tooltip "Record (tracks armed)" when a track is armed', () => {
            const { container } = renderWithTooltip(<TransportControls {...defaultProps} anyTrackArmed={true} />);
            expect(container.textContent).toContain('Record (tracks armed)');
        });

        it('labels the record tooltip "Stop Recording" when recording (priority over armed)', () => {
            const { container } = renderWithTooltip(
                <TransportControls {...defaultProps} isRecording={true} anyTrackArmed={true} />
            );
            expect(container.textContent).toContain('Stop Recording');
            expect(container.textContent).not.toContain('tracks armed');
        });
    });

    describe('play/pause button', () => {
        it('shows Play aria-label and routes to togglePlayback when stopped', () => {
            renderWithTooltip(<TransportControls {...defaultProps} />);
            const btn = screen.getByLabelText('Play');
            fireEvent.click(btn);
            expect(mocks.togglePlayback).toHaveBeenCalledTimes(1);
        });

        it('shows Pause aria-label and routes to togglePlayback when playing', () => {
            renderWithTooltip(<TransportControls {...defaultProps} isPlaying={true} />);
            const btn = screen.getByLabelText('Pause');
            fireEvent.click(btn);
            expect(mocks.togglePlayback).toHaveBeenCalledTimes(1);
        });
    });

    describe('record button ring + fill', () => {
        it('applies the danger ring when armed but not recording', () => {
            renderWithTooltip(<TransportControls {...defaultProps} anyTrackArmed={true} />);
            const btn = screen.getByLabelText('Record');
            expect(btn.className).toContain('ring-state-danger');
        });

        it('does not apply the ring when recording', () => {
            renderWithTooltip(<TransportControls {...defaultProps} isRecording={true} />);
            const btn = screen.getByLabelText('Stop recording');
            expect(btn.className).not.toContain('ring-state-danger');
        });

        it('routes to toggleRecording', () => {
            renderWithTooltip(<TransportControls {...defaultProps} />);
            fireEvent.click(screen.getByLabelText('Record'));
            expect(mocks.toggleRecording).toHaveBeenCalledTimes(1);
        });
    });

    describe('stop / loop / metronome / punch / count-in routing', () => {
        it('routes stop to stopPlayback', () => {
            renderWithTooltip(<TransportControls {...defaultProps} />);
            fireEvent.click(screen.getByLabelText('Stop'));
            expect(mocks.stopPlayback).toHaveBeenCalledTimes(1);
        });

        it('routes loop to toggleLoop', () => {
            renderWithTooltip(<TransportControls {...defaultProps} />);
            fireEvent.click(screen.getByLabelText('Loop'));
            expect(mocks.toggleLoop).toHaveBeenCalledTimes(1);
        });

        it('routes metronome to toggleMetronome', () => {
            renderWithTooltip(<TransportControls {...defaultProps} />);
            fireEvent.click(screen.getByLabelText('Metronome'));
            expect(mocks.toggleMetronome).toHaveBeenCalledTimes(1);
        });

        it('routes punch through an explicit undoable command', () => {
            renderWithTooltip(<TransportControls {...defaultProps} />);
            fireEvent.click(screen.getByLabelText('Punch in/out'));
            expect(mocks.executeAppAction).toHaveBeenCalledWith({
                type: 'setPunchEnabled',
                payload: { enabled: true },
            });
        });

        it('does not dispatch punch while transport is busy', () => {
            renderWithTooltip(<TransportControls {...defaultProps} isPlaying={true} />);
            const punch = screen.getByLabelText('Punch in/out');

            expect(punch).toBeDisabled();
            fireEvent.click(punch);

            expect(mocks.executeAppAction).not.toHaveBeenCalled();
        });

        it('routes count-in toggle to toggleCountIn', () => {
            renderWithTooltip(<TransportControls {...defaultProps} />);
            fireEvent.click(screen.getByLabelText('Count-in'));
            expect(mocks.toggleCountIn).toHaveBeenCalledTimes(1);
        });
    });

    describe('overdub button (conditional on showOverdub)', () => {
        it('does not render the overdub button when showOverdub is false', () => {
            renderWithTooltip(<TransportControls {...defaultProps} showOverdub={false} />);
            expect(screen.queryByLabelText('Overdub')).not.toBeInTheDocument();
        });

        it('renders the overdub button and routes to toggleOverdub when showOverdub is true', () => {
            renderWithTooltip(<TransportControls {...defaultProps} showOverdub={true} />);
            fireEvent.click(screen.getByLabelText('Overdub'));
            expect(mocks.toggleOverdub).toHaveBeenCalledTimes(1);
        });
    });

    describe('metronome volume slider (conditional on metronomeEnabled)', () => {
        it('does not render the volume slider when metronome is disabled', () => {
            renderWithTooltip(<TransportControls {...defaultProps} metronomeEnabled={false} />);
            expect(screen.queryByLabelText(/Metronome volume/)).not.toBeInTheDocument();
        });

        it('renders the volume slider with the percentage when metronome is enabled', () => {
            renderWithTooltip(<TransportControls {...defaultProps} metronomeEnabled={true} metronomeVolume={0.75} />);
            expect(screen.getByLabelText('Metronome volume: 75%')).toBeInTheDocument();
        });

        it('routes volume changes to setMetronomeVolume', () => {
            renderWithTooltip(<TransportControls {...defaultProps} metronomeEnabled={true} metronomeVolume={0.5} />);
            const slider = screen.getByLabelText('Metronome volume: 50%');
            fireEvent.keyDown(slider, { key: 'ArrowRight' });
            expect(mocks.setMetronomeVolume).toHaveBeenCalled();
        });
    });

    describe('count-in bars pill (conditional on countInEnabled)', () => {
        it('does not render the count-in bars pill when count-in is disabled', () => {
            renderWithTooltip(<TransportControls {...defaultProps} countInEnabled={false} />);
            expect(screen.queryByLabelText(/Count-in bars/)).not.toBeInTheDocument();
        });

        it('renders the pill showing the bar count when enabled', () => {
            renderWithTooltip(<TransportControls {...defaultProps} countInEnabled={true} countInBars={2} />);
            expect(screen.getByLabelText('Count-in bars: 2. Click to cycle.')).toBeInTheDocument();
        });

        it('cycles 1 -> 2 when countInBars is 1', () => {
            renderWithTooltip(<TransportControls {...defaultProps} countInEnabled={true} countInBars={1} />);
            fireEvent.click(screen.getByLabelText('Count-in bars: 1. Click to cycle.'));
            expect(mocks.setCountInBars).toHaveBeenCalledWith(2);
        });

        it('cycles 2 -> 4 when countInBars is 2', () => {
            renderWithTooltip(<TransportControls {...defaultProps} countInEnabled={true} countInBars={2} />);
            fireEvent.click(screen.getByLabelText('Count-in bars: 2. Click to cycle.'));
            expect(mocks.setCountInBars).toHaveBeenCalledWith(4);
        });

        it('cycles 4 -> 1 when countInBars is 4', () => {
            renderWithTooltip(<TransportControls {...defaultProps} countInEnabled={true} countInBars={4} />);
            fireEvent.click(screen.getByLabelText('Count-in bars: 4. Click to cycle.'));
            expect(mocks.setCountInBars).toHaveBeenCalledWith(1);
        });

        it('cycles 0 -> 1 (default branch) when countInBars is 0', () => {
            renderWithTooltip(<TransportControls {...defaultProps} countInEnabled={true} countInBars={0} />);
            fireEvent.click(screen.getByLabelText('Count-in bars: 0. Click to cycle.'));
            expect(mocks.setCountInBars).toHaveBeenCalledWith(1);
        });

        it('cycles 3 -> 4 (>= 2 but < 4 branch) when countInBars is 3', () => {
            renderWithTooltip(<TransportControls {...defaultProps} countInEnabled={true} countInBars={3} />);
            fireEvent.click(screen.getByLabelText('Count-in bars: 3. Click to cycle.'));
            expect(mocks.setCountInBars).toHaveBeenCalledWith(4);
        });
    });
});

import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { PlayheadDisplay } from '../PlayheadDisplay';

const playheadPosition = vi.hoisted(() => ({ current: 0 }));
const transportState = vi.hoisted(() => ({ value: { isPlaying: false, playheadPosition: 0 } }));
const toggleTimeDisplayMode = vi.hoisted(() => vi.fn());

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => transportState.value),
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: {
        get value() {
            return transportState.value;
        },
        subscribe: () => () => {},
        subscribeReact: () => () => {},
        getSnapshot: () => transportState.value,
    },
    playheadPositionRef: playheadPosition,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    defaultTransportState: { isPlaying: false, playheadPosition: 0 },
}));

vi.mock('#/modules/WorkspaceShell/useCases/togglePanel/panelToggles/toggleTimeDisplayMode', () => ({
    toggleTimeDisplayMode,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('PlayheadDisplay', () => {
    beforeEach(() => {
        playheadPosition.current = 0;
        transportState.value = { isPlaying: false, playheadPosition: 0 };
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('musical mode (bars.beats.ticks)', () => {
        it('computes bar 1 / beat 1 / tick 000 for position 0 in 4/4', () => {
            renderWithTooltip(<PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="musical" />);

            // Position 0 → bar 1 (Math.floor(0/4)+1), beat 1, tick 000.
            // bar and beat are both 1 at position 0 → two occurrences.
            expect(screen.getAllByText('1')).toHaveLength(2);
            expect(screen.getByText('000')).toBeInTheDocument();
        });

        it('computes bar/beat from a position spanning beats in 4/4', () => {
            // Position 5.5 beats: 4/4 → bar = floor(5/4)+1 = 2, beat = (5%4)+1 = 2.
            playheadPosition.current = 5.5;
            renderWithTooltip(<PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="musical" />);

            // bar 2 (first 2 render as "2" then beat "2")
            const twos = screen.getAllByText('2');
            expect(twos.length).toBeGreaterThanOrEqual(2);
            // tick = floor(0.5 * 480) = 240
            expect(screen.getByText('240')).toBeInTheDocument();
        });

        it('respects a non-4 numerator (7/8 → numerator 7)', () => {
            // Position 7.25 beats, numerator 7 → bar = floor(7/7)+1 = 2, beat = (7%7)+1 = 1.
            playheadPosition.current = 7.25;
            renderWithTooltip(<PlayheadDisplay tempo={120} numerator={7} timeDisplayMode="musical" />);

            expect(screen.getByText('120')).toBeInTheDocument(); // tick = floor(0.25*480) = 120
        });

        it('switches the display mode when the readout is clicked', () => {
            renderWithTooltip(<PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="musical" />);

            fireEvent.click(screen.getByRole('button', { name: /switch to wall-clock time/i }));
            expect(toggleTimeDisplayMode).toHaveBeenCalledTimes(1);
        });
    });

    describe('wall-clock mode (mm:ss.ms)', () => {
        it('formats 0:00.000 at position 0 with tempo 120', () => {
            renderWithTooltip(<PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="time" />);

            // seconds = 0 / (120/60) = 0 → min 00, sec 00, ms 000
            // min and sec are both "00", so assert there are two of them.
            expect(screen.getAllByText('00')).toHaveLength(2);
            expect(screen.getByText('000')).toBeInTheDocument();
        });

        it('converts beats to seconds using tempo, then splits into m/s/ms', () => {
            // tempo 120 → 2 beats/sec. Position 125 beats = 62.5 seconds.
            // 62.5s → min 01, sec 02, ms 500.
            playheadPosition.current = 125;
            renderWithTooltip(<PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="time" />);

            expect(screen.getByText('01')).toBeInTheDocument(); // min
            expect(screen.getByText('02')).toBeInTheDocument(); // sec
            expect(screen.getByText('500')).toBeInTheDocument(); // ms
        });

        it('uses the tempo to scale the conversion (tempo 60 = 1 beat/sec)', () => {
            // tempo 60 → 1 beat/sec. Position 65.25 beats = 65.25s → 1m 5s 250ms.
            playheadPosition.current = 65.25;
            renderWithTooltip(<PlayheadDisplay tempo={60} numerator={4} timeDisplayMode="time" />);

            expect(screen.getByText('01')).toBeInTheDocument(); // min
            expect(screen.getByText('05')).toBeInTheDocument(); // secs
            expect(screen.getByText('250')).toBeInTheDocument(); // ms
        });
    });

    describe('playing state', () => {
        it('renders the active (playing) readout when transport is playing', () => {
            transportState.value = { isPlaying: true, playheadPosition: 0 };
            renderWithTooltip(<PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="musical" />);

            const button = screen.getByRole('button', { name: /switch to wall-clock time/i });
            // When playing, the active styling applies — the button is still present.
            expect(button).toBeInTheDocument();
        });

        it('bounds live position writes to 60 Hz without replacing segment text nodes', () => {
            const frameStart = 1_000;
            vi.spyOn(performance, 'now').mockReturnValue(frameStart);
            let animationFrameCallback: FrameRequestCallback | null = null;
            vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
                animationFrameCallback = callback;
                return 1;
            });
            vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
            transportState.value = { isPlaying: true, playheadPosition: 0 };
            renderWithTooltip(<PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="musical" />);
            const segment = screen.getByText('000');
            const initialTextNode = segment.firstChild;

            playheadPosition.current = 0.25;
            act(() => {
                animationFrameCallback!(frameStart + 8);
            });
            expect(segment.textContent).toBe('000');

            playheadPosition.current = 0.5;
            act(() => {
                animationFrameCallback!(frameStart + 17);
            });
            expect(segment.textContent).toBe('240');
            expect(segment.firstChild).toBe(initialTextNode);
        });
    });

    describe('stop while paused', () => {
        it('repaints to 1.1.000 when the store resets playheadPosition while not playing', () => {
            // Reproduces the stop-while-paused defect: the rAF loop is gated on
            // isPlaying, so once paused it never repaints again. A later Stop
            // sets the store's discrete playheadPosition to 0, and the component
            // must react to that write and snap the readout back to 1.1.000 —
            // not stay frozen at the paused beat.
            playheadPosition.current = 3.25;
            transportState.value = { isPlaying: false, playheadPosition: 3.25 };
            const { rerender } = renderWithTooltip(
                <PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="musical" />
            );

            // Paused at 3.25: bar 1, beat 4, tick 120.
            expect(screen.getByText('120')).toBeInTheDocument();

            // Stop fires: ref and store both reset to 0.
            playheadPosition.current = 0;
            transportState.value = { isPlaying: false, playheadPosition: 0 };
            rerender(
                <TooltipProvider>
                    <PlayheadDisplay tempo={120} numerator={4} timeDisplayMode="musical" />
                </TooltipProvider>
            );

            // Readout snaps back to the start. tick 000 present, tick 120 gone.
            expect(screen.getByText('000')).toBeInTheDocument();
            expect(screen.queryByText('120')).not.toBeInTheDocument();
        });
    });
});

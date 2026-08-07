import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixerLevelReadout } from '../MixerLevelReadout';

type SchedulerTick = (currentTime: DOMHighResTimeStamp, deltaMs: number) => void;

const mocks = vi.hoisted(() => ({
    getMasterPeakLevel: vi.fn<() => number | null>(() => 0),
    getTrackPeakLevel: vi.fn(() => 0),
    register: vi.fn<(id: string, callback: (currentTime: DOMHighResTimeStamp, deltaMs: number) => void) => void>(),
    unregister: vi.fn<(id: string) => void>(),
    scheduledTick: null as ((currentTime: DOMHighResTimeStamp, deltaMs: number) => void) | null,
}));

vi.mock('#/modules/AudioEngine/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/AudioEngine/useCases')>(
        '#/modules/AudioEngine/useCases'
    );

    return {
        ...actual,
        getMasterPeakLevel: mocks.getMasterPeakLevel,
        getTrackPeakLevel: mocks.getTrackPeakLevel,
    };
});

vi.mock('#/modules/Metering/presentations/views', () => ({
    LevelMeter: ({ trackId }: { trackId: string | null }) => (
        <div data-testid="level-meter" data-track-id={trackId ?? ''} />
    ),
}));

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: mocks.register.mockImplementation((_id: string, callback: SchedulerTick) => {
            mocks.scheduledTick = callback;
        }),
        unregister: mocks.unregister,
    },
}));

const getPeakReadout = () => screen.getByTitle('Click to reset peak');

describe('MixerLevelReadout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getMasterPeakLevel.mockReturnValue(0);
        mocks.getTrackPeakLevel.mockReturnValue(0);
        mocks.scheduledTick = null;
    });

    it('renders the supplied control and value nodes plus a meter bound to the track', () => {
        render(<MixerLevelReadout trackId="track-1" control={<button type="button">Gain</button>} value="0.0 dB" />);

        expect(screen.getByRole('button', { name: 'Gain' })).toBeInTheDocument();
        expect(screen.getByText('0.0 dB')).toBeInTheDocument();
        expect(screen.getByTestId('level-meter')).toHaveAttribute('data-track-id', 'track-1');
        expect(getPeakReadout()).toHaveTextContent('-∞');
    });

    it('registers a peak tick on mount and unregisters the same id on unmount', () => {
        const { unmount } = render(<MixerLevelReadout trackId="track-1" control={null} value={null} />);

        expect(mocks.register).toHaveBeenCalledTimes(1);
        const call = mocks.register.mock.calls[0];
        if (!call) {
            throw new Error('animationScheduler.register was not called');
        }
        const [id] = call;
        expect(id).toMatch(/^peak-readout-/);

        unmount();
        expect(mocks.unregister).toHaveBeenCalledWith(id);
    });

    it('reads the bound track peak and shows the loudest level observed, in dB', () => {
        mocks.getTrackPeakLevel.mockReturnValue(1);
        render(<MixerLevelReadout trackId="track-1" control={null} value={null} />);

        mocks.scheduledTick?.(0, 16);
        expect(mocks.getTrackPeakLevel).toHaveBeenCalledWith('track-1');
        expect(mocks.getMasterPeakLevel).not.toHaveBeenCalled();
        expect(getPeakReadout()).toHaveTextContent('0.0');

        // A quieter follow-up sample must not pull a held peak back down.
        mocks.getTrackPeakLevel.mockReturnValue(0.1);
        mocks.scheduledTick?.(0, 16);
        expect(getPeakReadout()).toHaveTextContent('0.0');
    });

    it('falls back to the master peak level when no track is bound', () => {
        mocks.getMasterPeakLevel.mockReturnValue(1);
        render(<MixerLevelReadout trackId={null} control={null} value={null} />);

        mocks.scheduledTick?.(0, 16);
        expect(mocks.getMasterPeakLevel).toHaveBeenCalledTimes(1);
        expect(mocks.getTrackPeakLevel).not.toHaveBeenCalled();
        expect(getPeakReadout()).toHaveTextContent('0.0');
    });

    // ── "no meter tap" is not "-∞" ─────────────────────────────────────────────
    //
    // getMasterPeakLevel() returns null when the engine has no metering tap in the
    // master chain. "-∞" is the readout for a bus that was measured and found
    // silent, so printing it here claims a measurement nobody took (ADR 0012).
    it('reads "n/a" for the master bus when the level is unavailable', () => {
        mocks.getMasterPeakLevel.mockReturnValue(null);
        render(<MixerLevelReadout trackId={null} control={null} value={null} />);

        mocks.scheduledTick?.(0, 16);

        expect(getPeakReadout()).toHaveTextContent('n/a');
    });

    it('drops a previously held peak once the master meter tap goes away', () => {
        mocks.getMasterPeakLevel.mockReturnValue(1);
        render(<MixerLevelReadout trackId={null} control={null} value={null} />);
        mocks.scheduledTick?.(0, 16);
        expect(getPeakReadout()).toHaveTextContent('0.0');

        // The tap is torn down (engine disposed / re-initializing). The held
        // 0.0 dB describes a bus nobody is measuring any more.
        mocks.getMasterPeakLevel.mockReturnValue(null);
        mocks.scheduledTick?.(16, 16);

        expect(getPeakReadout()).toHaveTextContent('n/a');

        // The hold is dropped with it: when the tap returns, a quieter peak must
        // be shown rather than suppressed by the 0.0 dB held across the outage.
        mocks.getMasterPeakLevel.mockReturnValue(0.5);
        mocks.scheduledTick?.(32, 16);

        expect(getPeakReadout()).toHaveTextContent('-6.0');
    });

    it('flags a peak above 0 dB as an over, and clicking resets it', () => {
        mocks.getTrackPeakLevel.mockReturnValue(1.5);
        render(<MixerLevelReadout trackId="track-1" control={null} value={null} />);

        mocks.scheduledTick?.(0, 16);
        const readout = getPeakReadout();
        expect(readout).toHaveClass('text-state-error');
        expect(readout).not.toHaveClass('text-muted-foreground/80');

        fireEvent.click(readout);
        expect(readout).toHaveTextContent('-∞');
        expect(readout).not.toHaveClass('text-state-error');
        expect(readout).toHaveClass('text-muted-foreground/80');
    });

    it('applies clusterClassName to the cluster and valueSize to the value text', () => {
        render(
            <MixerLevelReadout
                trackId={null}
                control={null}
                value="1.0 dB"
                clusterClassName="my-cluster"
                valueSize="sm"
            />
        );

        expect(getPeakReadout().parentElement).toHaveClass('my-cluster');
        expect(screen.getByText('1.0 dB')).toHaveClass('text-[9px]');
    });
});

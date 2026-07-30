import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixerLevelReadout } from '../MixerLevelReadout';

const mocks = vi.hoisted(() => ({
    unsubscribe: vi.fn(),
    subscribePeakMeter:
        vi.fn<
            (input: {
                trackId: string | null;
                onFrame: (peak: number, currentTime: DOMHighResTimeStamp, deltaMs: number) => void;
            }) => () => void
        >(),
    scheduledTick: null as ((peak: number) => void) | null,
}));

vi.mock('#/modules/AudioEngine/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/AudioEngine/useCases')>(
        '#/modules/AudioEngine/useCases'
    );

    return {
        ...actual,
        subscribePeakMeter: mocks.subscribePeakMeter.mockImplementation((input) => {
            mocks.scheduledTick = (peak) => {
                input.onFrame(peak, 0, 16);
            };
            return mocks.unsubscribe;
        }),
    };
});

vi.mock('#/modules/Metering/presentations/views', () => ({
    LevelMeter: ({ trackId }: { trackId: string | null }) => (
        <div data-testid="level-meter" data-track-id={trackId ?? ''} />
    ),
}));

const getPeakReadout = () => screen.getByTitle('Click to reset peak');

describe('MixerLevelReadout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.scheduledTick = null;
    });

    it('renders the supplied control and value nodes plus a meter bound to the track', () => {
        render(<MixerLevelReadout trackId="track-1" control={<button type="button">Gain</button>} value="0.0 dB" />);

        expect(screen.getByRole('button', { name: 'Gain' })).toBeInTheDocument();
        expect(screen.getByText('0.0 dB')).toBeInTheDocument();
        expect(screen.getByTestId('level-meter')).toHaveAttribute('data-track-id', 'track-1');
        expect(getPeakReadout()).toHaveTextContent('-∞');
    });

    it('subscribes to the requested meter and releases it on unmount', () => {
        const { unmount } = render(<MixerLevelReadout trackId="track-1" control={null} value={null} />);

        const subscription = mocks.subscribePeakMeter.mock.calls[0]?.[0];
        expect(subscription?.trackId).toBe('track-1');
        expect(typeof subscription?.onFrame).toBe('function');

        unmount();
        expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('shows the loudest level delivered by the shared meter, in dB', () => {
        render(<MixerLevelReadout trackId="track-1" control={null} value={null} />);

        mocks.scheduledTick?.(1);
        expect(getPeakReadout()).toHaveTextContent('0.0');

        // A quieter follow-up sample must not pull a held peak back down.
        mocks.scheduledTick?.(0.1);
        expect(getPeakReadout()).toHaveTextContent('0.0');
    });

    it('subscribes to the master meter when no track is bound', () => {
        render(<MixerLevelReadout trackId={null} control={null} value={null} />);

        const subscription = mocks.subscribePeakMeter.mock.calls[0]?.[0];
        expect(subscription?.trackId).toBeNull();
        expect(typeof subscription?.onFrame).toBe('function');
        mocks.scheduledTick?.(1);
        expect(getPeakReadout()).toHaveTextContent('0.0');
    });

    it('shows a peak above 0 dB and clicking resets it', () => {
        render(<MixerLevelReadout trackId="track-1" control={null} value={null} />);

        mocks.scheduledTick?.(1.5);
        const readout = getPeakReadout();
        expect(readout).toHaveAccessibleName('Peak level: 3.5 dB. Click to reset.');

        fireEvent.click(readout);
        expect(readout).toHaveTextContent('-∞');
        expect(readout).toHaveAccessibleName('Peak level: -∞ dB. Click to reset.');
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

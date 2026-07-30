import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { LevelMeter } from '../LevelMeter';

const mocks = vi.hoisted(() => ({
    unsubscribe: vi.fn(),
    subscribePeakMeter:
        vi.fn<
            (input: {
                trackId: string | null;
                onFrame: (peak: number, currentTime: DOMHighResTimeStamp, deltaMs: number) => void;
            }) => () => void
        >(),
    scheduledTick: null as ((peak: number, currentTime: DOMHighResTimeStamp, deltaMs: number) => void) | null,
}));

vi.mock('#/modules/AudioEngine/useCases', async () => {
    const actual = await vi.importActual<typeof import('#/modules/AudioEngine/useCases')>(
        '#/modules/AudioEngine/useCases'
    );

    return {
        ...actual,
        subscribePeakMeter: mocks.subscribePeakMeter.mockImplementation(
            (input: {
                trackId: string | null;
                onFrame: (peak: number, currentTime: DOMHighResTimeStamp, deltaMs: number) => void;
            }) => {
                mocks.scheduledTick = input.onFrame;
                return mocks.unsubscribe;
            }
        ),
    };
});

const OriginalResizeObserver = globalThis.ResizeObserver;

class LevelMeterResizeObserver {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }

    observe(target: Element): void {
        this.callback(
            [
                {
                    target,
                    contentRect: DOMRectReadOnly.fromRect({ width: 8, height: 100 }),
                } as ResizeObserverEntry,
            ],
            this
        );
    }

    unobserve(): void {}

    disconnect(): void {}
}

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('LevelMeter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.scheduledTick = null;
        globalThis.ResizeObserver = LevelMeterResizeObserver;
    });

    afterEach(() => {
        globalThis.ResizeObserver = OriginalResizeObserver;
    });

    it('subscribes to the requested meter and releases it on unmount', () => {
        const { unmount } = renderWithTooltip(<LevelMeter trackId="track-1" />);

        const subscription = mocks.subscribePeakMeter.mock.calls[0]?.[0];
        expect(subscription?.trackId).toBe('track-1');
        expect(typeof subscription?.onFrame).toBe('function');

        unmount();
        expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('should hold transient peak level separately from smoothed VU level', () => {
        const canvasContext = document.createElement('canvas').getContext('2d');
        expect(canvasContext).not.toBeNull();
        const fillRectSpy = vi.spyOn(canvasContext!, 'fillRect');

        renderWithTooltip(<LevelMeter trackId={null} />);

        expect(mocks.scheduledTick).not.toBeNull();
        mocks.scheduledTick!(1, 0, 16);

        const peakHoldCalls = fillRectSpy.mock.calls.filter((call) => call[3] === 1.5);
        expect(peakHoldCalls).toContainEqual([0, 0, 8, 1.5]);
    });
});

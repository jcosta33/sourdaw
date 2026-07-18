import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { LevelMeter } from '../LevelMeter';

const mocks = vi.hoisted(() => ({
    getMasterPeakLevel: vi.fn(() => 0),
    getTrackPeakLevel: vi.fn(() => 0),
    register: vi.fn(),
    unregister: vi.fn(),
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

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: mocks.register.mockImplementation(
            (_id: string, callback: (currentTime: DOMHighResTimeStamp, deltaMs: number) => void) => {
                mocks.scheduledTick = callback;
            }
        ),
        unregister: mocks.unregister,
    },
}));

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
            this as unknown as ResizeObserver
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
        mocks.getMasterPeakLevel.mockReturnValue(0);
        mocks.getTrackPeakLevel.mockReturnValue(0);
        mocks.scheduledTick = null;
        globalThis.ResizeObserver = LevelMeterResizeObserver as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
        globalThis.ResizeObserver = OriginalResizeObserver;
    });

    it('should render without crashing', () => {
        renderWithTooltip(<LevelMeter trackId={null} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(<LevelMeter trackId={null} />);
        expect(document.body).toBeTruthy();
    });

    it('should hold transient peak level separately from smoothed VU level', () => {
        const canvasContext = document.createElement('canvas').getContext('2d');
        expect(canvasContext).not.toBeNull();
        const fillRectSpy = vi.spyOn(canvasContext!, 'fillRect');

        mocks.getMasterPeakLevel.mockReturnValue(1);
        renderWithTooltip(<LevelMeter trackId={null} />);

        expect(mocks.scheduledTick).not.toBeNull();
        mocks.scheduledTick!(0, 16);

        const peakHoldCalls = fillRectSpy.mock.calls.filter((call) => call[3] === 1.5);
        expect(peakHoldCalls).toContainEqual([0, 0, 8, 1.5]);
    });
});

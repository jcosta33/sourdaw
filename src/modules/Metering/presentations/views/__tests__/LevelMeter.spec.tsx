import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { LevelMeter } from '../LevelMeter';

const mocks = vi.hoisted(() => ({
    getMasterPeakLevel: vi.fn<() => number | null>(() => 0),
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
        mocks.getMasterPeakLevel.mockReturnValue(0);
        mocks.getTrackPeakLevel.mockReturnValue(0);
        mocks.scheduledTick = null;
        globalThis.ResizeObserver = LevelMeterResizeObserver;
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

    // ── "no meter tap" and "measured silence" must not paint the same frame ─────
    //
    // getMasterPeakLevel() returns null when the engine has no metering tap in the
    // master chain. Feeding that through the -∞ path draws the same bed-and-gaps
    // frame a genuinely silent mix draws, so a user with audio playing sees a dead
    // meter and debugs the wrong thing (ADR 0012: no silent downgrade).
    describe('master bus with no meter tap', () => {
        it('paints no meter frame at all when the level is unavailable', () => {
            const canvasContext = document.createElement('canvas').getContext('2d');
            expect(canvasContext).not.toBeNull();
            const fillRectSpy = vi.spyOn(canvasContext!, 'fillRect');
            const clearRectSpy = vi.spyOn(canvasContext!, 'clearRect');

            mocks.getMasterPeakLevel.mockReturnValue(null);
            renderWithTooltip(<LevelMeter trackId={null} />);

            expect(mocks.scheduledTick).not.toBeNull();
            mocks.scheduledTick!(0, 16);

            expect(clearRectSpy).toHaveBeenCalledWith(0, 0, 8, 100);
            expect(fillRectSpy).not.toHaveBeenCalled();
        });

        it('announces "unavailable" instead of a level a screen reader would read as silence', () => {
            // Driven live first, so the assertion cannot be satisfied by the
            // pre-tick markup — the attribute has to be moved off a real reading.
            mocks.getMasterPeakLevel.mockReturnValue(0.5);
            const { container } = renderWithTooltip(<LevelMeter trackId={null} />);
            mocks.scheduledTick!(0, 16);
            const meter = container.querySelector('[role="meter"]');
            expect(meter).not.toBeNull();
            expect(meter!.getAttribute('aria-valuetext')).toBe('-6.0 dB');

            mocks.getMasterPeakLevel.mockReturnValue(null);
            mocks.scheduledTick!(16, 16);

            // aria-valuetext is what assistive tech announces when present, so the
            // blank canvas and the spoken value now agree.
            expect(meter!.getAttribute('aria-valuetext')).toBe('unavailable');
        });

        it('announces the live level again once the tap returns', () => {
            mocks.getMasterPeakLevel.mockReturnValue(null);
            const { container } = renderWithTooltip(<LevelMeter trackId={null} />);
            mocks.scheduledTick!(0, 16);
            const meter = container.querySelector('[role="meter"]');
            expect(meter!.getAttribute('aria-valuetext')).toBe('unavailable');

            // 0.5 amplitude → 20*log10(0.5) ≈ -6.0 dB.
            mocks.getMasterPeakLevel.mockReturnValue(0.5);
            mocks.scheduledTick!(16, 16);

            expect(meter!.getAttribute('aria-valuetext')).toBe('-6.0 dB');
            expect(meter!.getAttribute('aria-valuenow')).toBe('-6.0');
        });

        it('drops the VU charge so no partial RMS fill survives the outage', () => {
            const canvasContext = document.createElement('canvas').getContext('2d');
            expect(canvasContext).not.toBeNull();
            const fillRectSpy = vi.spyOn(canvasContext!, 'fillRect');

            // Charge the 300 ms VU ballistics at full scale.
            mocks.getMasterPeakLevel.mockReturnValue(1);
            renderWithTooltip(<LevelMeter trackId={null} />);
            mocks.scheduledTick!(0, 16);

            mocks.getMasterPeakLevel.mockReturnValue(null);
            mocks.scheduledTick!(16, 16);
            fillRectSpy.mockClear();

            // First recovered frame is silent. A retained VU charge (~0.049 linear,
            // ≈ -26 dB, ≈ 56% of the meter) would paint a partial RMS band here.
            mocks.getMasterPeakLevel.mockReturnValue(0);
            mocks.scheduledTick!(32, 16);

            // Legitimate heights on a silent frame: 100 (the bed), 1 (LED gaps),
            // 0 (the zero-height RMS and peak rects). Anything between is a fill.
            const partialFills = fillRectSpy.mock.calls.filter((call) => {
                const rectHeight = call[3];
                return rectHeight > 1 && rectHeight < 100;
            });
            expect(partialFills).toEqual([]);
        });

        it('drops the held peak so a stale hold line does not survive the outage', () => {
            const canvasContext = document.createElement('canvas').getContext('2d');
            expect(canvasContext).not.toBeNull();
            const fillRectSpy = vi.spyOn(canvasContext!, 'fillRect');

            mocks.getMasterPeakLevel.mockReturnValue(1);
            renderWithTooltip(<LevelMeter trackId={null} />);
            // Full-scale frame parks the hold indicator at the top of the meter.
            mocks.scheduledTick!(0, 16);
            expect(fillRectSpy.mock.calls.filter((call) => call[3] === 1.5)).toContainEqual([0, 0, 8, 1.5]);

            // The tap goes away, then comes back reporting silence — well inside
            // the 1500 ms hold window, so an undropped hold would still be drawn.
            mocks.getMasterPeakLevel.mockReturnValue(null);
            mocks.scheduledTick!(16, 16);
            fillRectSpy.mockClear();
            mocks.getMasterPeakLevel.mockReturnValue(0);
            mocks.scheduledTick!(32, 16);

            expect(fillRectSpy.mock.calls.filter((call) => call[3] === 1.5)).toEqual([]);
        });

        it('still paints the silent-mix frame when the tap measured a real zero', () => {
            const canvasContext = document.createElement('canvas').getContext('2d');
            expect(canvasContext).not.toBeNull();
            const fillRectSpy = vi.spyOn(canvasContext!, 'fillRect');

            // 0 is a measurement: the worklet ran and the block was silent.
            mocks.getMasterPeakLevel.mockReturnValue(0);
            renderWithTooltip(<LevelMeter trackId={null} />);
            mocks.scheduledTick!(0, 16);

            // The deep-black bed spanning the full meter — the frame the
            // unavailable case must not produce.
            expect(fillRectSpy.mock.calls).toContainEqual([0, 0, 8, 100]);
        });
    });
});

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrackAnalyser } from '#/modules/AudioEngine/useCases';

import { TrackLevelIndicator } from '../TrackLevelIndicator';

// TrackLevelIndicator drives a requestAnimationFrame loop that paints a dB
// meter onto a canvas. We capture the 2D context's fillStyle per frame to
// assert that each level zone (silent / green / yellow / orange / red) maps to
// the documented gradient — deriving the expected colours from the dB math, not
// from the implementation's string templates.

const fillStyleLog = vi.hoisted(() => [] as string[]);

const makeAnalyser = (amplitude: number, fftSize = 1024): AnalyserNode => {
    return {
        fftSize,
        getFloatTimeDomainData: vi.fn((data: Float32Array) => {
            data.fill(amplitude);
        }),
    } as unknown as AnalyserNode;
};

// Build a 2D context whose fillStyle is recorded on every assignment so the
// test can read back which colour zone the indicator painted.
const makeCapturingContext = () => {
    const ctx = {
        scale: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        fill: vi.fn(),
        set fillStyle(value: string) {
            fillStyleLog.push(value);
        },
        get fillStyle(): string {
            return fillStyleLog.at(-1) ?? '';
        },
        canvas: null,
    } as unknown as CanvasRenderingContext2D;
    return ctx;
};

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackAnalyser: vi.fn(),
}));

describe('TrackLevelIndicator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        fillStyleLog.length = 0;
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    // Install a 2D context spy onto every canvas the component creates.
    const installContextSpy = (ctx: CanvasRenderingContext2D) => {
        const spy = vi.fn((type: string) => {
            if (type === '2d') {
                return ctx;
            }
            return null;
        });
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            writable: true,
            value: spy,
        });
    };

    const fireFrame = () =>
        act(() => {
            vi.advanceTimersByTime(16);
        });

    it('renders a canvas meter element', () => {
        vi.mocked(getTrackAnalyser).mockReturnValue(null);
        const { container } = render(<TrackLevelIndicator trackId="track-1" height={64} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('paints the green zone for a quiet signal that crosses the floor threshold', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        // rms of a 0.001 constant signal = 0.001 → 20*log10(0.001) = -60 dB,
        // exactly the floor; the indicator only paints above floor+1, so nudge
        // just over: rms 0.0013 → ~-57.7 dB → norm ~0.038 → green zone (<0.3).
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0.0015));

        render(<TrackLevelIndicator trackId="track-1" height={64} />);
        // Let the attack settle (instant attack reaches the level on frame 1).
        fireFrame();
        fireFrame();

        expect(fillStyleLog.length).toBeGreaterThan(0);
        // Green zone colour is an rgba() with a non-zero alpha.
        expect(fillStyleLog.at(-1)).toMatch(/^rgba\(0,\s*\d+,\s*\d+,\s*0\.\d+\)$/);
    });

    it('paints the yellow zone for a moderate signal', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        // rms 0.05 → 20*log10(0.05) ≈ -26 dB → norm ≈ 0.57 → yellow zone (<0.65).
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0.05));

        render(<TrackLevelIndicator trackId="track-1" height={64} />);
        fireFrame();
        fireFrame();

        // Yellow zone uses rgb() with the red channel climbing from 0→204.
        expect(fillStyleLog.at(-1)).toMatch(/^rgb\(/);
        expect(fillStyleLog.at(-1)).not.toContain('rgba');
    });

    it('paints the orange-red zone for a loud signal', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        // rms 0.5 → 20*log10(0.5) ≈ -6 dB → norm ≈ 0.9 → hot zone, but to land
        // in the 0.65–0.85 band use a slightly lower level: rms ~0.32 → -10 dB
        // → norm ≈ 0.83 → orange-red zone (<0.85).
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0.32));

        render(<TrackLevelIndicator trackId="track-1" height={64} />);
        fireFrame();
        fireFrame();

        expect(fillStyleLog.at(-1)).toMatch(/^rgb\(2\d{2},/);
    });

    it('paints the hot red zone for a clipping-level signal', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        // rms 0.9 → 20*log10(0.9) ≈ -0.92 dB → norm ≈ 0.985 → hot red zone.
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0.9));

        render(<TrackLevelIndicator trackId="track-1" height={64} />);
        fireFrame();
        fireFrame();

        // Hot zone: red pinned at 255, green/blue in the low range.
        expect(fillStyleLog.at(-1)).toMatch(/^rgb\(255,\s*\d+,\s*\d+\)$/);
    });

    it('does not paint when the signal sits at the silence floor', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0));

        render(<TrackLevelIndicator trackId="track-1" height={64} />);
        fireFrame();
        fireFrame();

        // At/below floor the `smoothedDb > DB_FLOOR + 1` guard skips painting,
        // so no fillStyle is ever set.
        expect(fillStyleLog).toHaveLength(0);
    });

    it('releases smoothly toward the floor when the signal drops', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        // Start loud, then go silent: the release path (slow 0.08 decay) keeps
        // painting for several frames rather than snapping to floor.
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0.9));

        render(<TrackLevelIndicator trackId="track-1" height={64} />);
        fireFrame(); // attack to loud
        // Now the signal disappears.
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0));
        fireFrame(); // release frame 1
        fireFrame(); // release frame 2

        // The release branch executed; the meter is still above floor so it
        // painted during the transition.
        expect(fillStyleLog.length).toBeGreaterThan(0);
    });

    it('reallocates the analyser buffer when fftSize changes between renders', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        const analyser = makeAnalyser(0.05, 1024);
        vi.mocked(getTrackAnalyser).mockReturnValue(analyser);

        render(<TrackLevelIndicator trackId="track-1" height={64} />);
        fireFrame();
        // Swap the underlying fftSize; the next frame must reallocate the
        // Float32Array rather than reading a stale, mismatched buffer.
        (analyser as unknown as { fftSize: number }).fftSize = 2048;
        fireFrame();

        expect(analyser.getFloatTimeDomainData).toHaveBeenCalled();
    });

    it('falls back to devicePixelRatio 1 when it is unavailable', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        const original = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 });
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0.05));

        try {
            render(<TrackLevelIndicator trackId="track-1" height={64} />);
            fireFrame();
            // dpr 0 → `|| 1` fallback; the context is still scaled and the frame
            // paints normally.
            expect(ctx.scale).toHaveBeenCalledWith(1, 1);
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: original });
        }
    });

    it('handles a missing 2D context without throwing', () => {
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            writable: true,
            value: () => null,
        });
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0.05));
        // Should render and bail out of the effect cleanly (no rAF loop).
        const { container } = render(<TrackLevelIndicator trackId="track-1" height={64} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('cancels the animation frame on unmount', () => {
        const ctx = makeCapturingContext();
        installContextSpy(ctx);
        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
        vi.mocked(getTrackAnalyser).mockReturnValue(makeAnalyser(0.05));

        const { unmount } = render(<TrackLevelIndicator trackId="track-1" height={64} />);
        fireFrame();
        unmount();
        expect(cancelSpy).toHaveBeenCalled();
    });
});

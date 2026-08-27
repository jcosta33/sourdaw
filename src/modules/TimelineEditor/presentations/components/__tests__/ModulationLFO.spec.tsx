import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { ModulationLFO } from '../ModulationLFO';

type GetContext2d = (contextId: '2d', options?: CanvasRenderingContext2DSettings) => CanvasRenderingContext2D | null;

function spyOnGetContext(ctx: CanvasRenderingContext2D | null): void {
    const proto: { getContext: GetContext2d } = HTMLCanvasElement.prototype;
    vi.spyOn(proto, 'getContext').mockReturnValue(ctx);
}

function make2dContext(): CanvasRenderingContext2D {
    return document.createElement('canvas').getContext('2d')!;
}

function captureAnimationFrames(): { callbacks: FrameRequestCallback[]; rafSpy: ReturnType<typeof vi.spyOn> } {
    const callbacks: FrameRequestCallback[] = [];
    let nextId = 1;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        callbacks.push(callback);
        return nextId++;
    });
    return { callbacks, rafSpy };
}

describe('ModulationLFO', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('should mount a canvas for waveform preview', () => {
        const { container } = render(<ModulationLFO rate={2} depth={0.5} shape="sine" width={100} height={40} />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('scales the canvas backing store to devicePixelRatio and requests the first frame', () => {
        const ctx = make2dContext();
        const scaleSpy = vi.spyOn(ctx, 'scale');
        spyOnGetContext(ctx);
        const { rafSpy } = captureAnimationFrames();

        const { container } = render(<ModulationLFO rate={3} depth={0.5} shape="sine" width={64} height={32} />);
        const canvas = container.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError('Expected a ModulationLFO canvas');
        }

        expect(canvas.width).toBe(64);
        expect(canvas.height).toBe(32);
        expect(scaleSpy).toHaveBeenCalledWith(1, 1);
        expect(rafSpy).toHaveBeenCalledTimes(1);
        expect(canvas).toHaveAttribute('aria-label', 'LFO modulation: sine at 3.0 Hz');
    });

    it('clears and repaints the background, center line, and rate label each frame', () => {
        const ctx = make2dContext();
        spyOnGetContext(ctx);
        const { callbacks } = captureAnimationFrames();

        render(<ModulationLFO rate={2.5} depth={0.5} shape="sine" width={20} height={20} />);

        const clearRectSpy = vi.spyOn(ctx, 'clearRect');
        const roundRectSpy = vi.spyOn(ctx, 'roundRect');
        const fillTextSpy = vi.spyOn(ctx, 'fillText');
        const strokeSpy = vi.spyOn(ctx, 'stroke');

        const draw = callbacks.at(0);
        if (!draw) {
            throw new Error('Expected the effect to schedule a draw frame');
        }
        draw(0);

        expect(clearRectSpy).toHaveBeenCalledWith(0, 0, 20, 20);
        expect(roundRectSpy).toHaveBeenCalledWith(0, 0, 20, 20, 4);
        expect(fillTextSpy).toHaveBeenCalledWith('2.5 Hz', 16, 17);
        // Background fill, center line, waveform stroke, waveform fill: the path is stroked at least twice.
        expect(strokeSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('produces distinct waveform samples for sine, triangle, and square shapes at the same phase', () => {
        const expectations: Array<{ shape: 'sine' | 'triangle' | 'square'; y: number }> = [
            { shape: 'square', y: 16 },
            { shape: 'triangle', y: 4 },
            { shape: 'sine', y: 10 },
        ];

        for (const { shape, y } of expectations) {
            const ctx = make2dContext();
            spyOnGetContext(ctx);
            const { callbacks } = captureAnimationFrames();
            const lineToSpy = vi.spyOn(ctx, 'lineTo');

            const { unmount } = render(
                // rate=0 makes the waveform time-invariant: phase depends only on x, not on
                // the animation timestamp, so the sample at a given x is deterministic.
                <ModulationLFO rate={0} depth={1} shape={shape} width={20} height={20} />
            );
            const draw = callbacks.at(0);
            if (!draw) {
                throw new Error('Expected the effect to schedule a draw frame');
            }
            draw(0);

            // x=5 lands exactly at the half-cycle phase (0.5) for a 2-cycle, 20px-wide sweep.
            const sampleAtHalfCycle = lineToSpy.mock.calls.find((call) => call[0] === 5);
            expect(sampleAtHalfCycle?.[1]).toBeCloseTo(y, 5);

            unmount();
            vi.restoreAllMocks();
        }
    });

    it('clamps depth above 1 so the waveform amplitude never exceeds the plotted half-height', () => {
        const ctx = make2dContext();
        spyOnGetContext(ctx);
        const { callbacks } = captureAnimationFrames();
        const lineToSpy = vi.spyOn(ctx, 'lineTo');

        render(<ModulationLFO rate={0} depth={2} shape="square" width={20} height={20} />);
        const draw = callbacks.at(0);
        if (!draw) {
            throw new Error('Expected the effect to schedule a draw frame');
        }
        draw(0);

        // Same y as depth=1 (16), not the unclamped depth=2 value (22).
        const sampleAtHalfCycle = lineToSpy.mock.calls.find((call) => call[0] === 5);
        expect(sampleAtHalfCycle?.[1]).toBeCloseTo(16, 5);
    });

    it('rides the position marker along the accumulated phase across frames', () => {
        const ctx = make2dContext();
        spyOnGetContext(ctx);
        const { callbacks } = captureAnimationFrames();
        const arcSpy = vi.spyOn(ctx, 'arc');

        render(<ModulationLFO rate={1} depth={0.5} shape="sine" width={20} height={20} />);
        const draw = callbacks.at(0);
        if (!draw) {
            throw new Error('Expected the effect to schedule a draw frame');
        }

        // First frame anchors the clock: no elapsed time yet, marker at x=0.
        draw(1000);
        expect(arcSpy).toHaveBeenLastCalledWith(0, expect.any(Number), 2.5, 0, Math.PI * 2);

        // 0.5s later at 1Hz the phase is 0.5 of the 2 visible cycles → x=5.
        draw(1500);
        expect(arcSpy).toHaveBeenLastCalledWith(5, expect.any(Number), 2.5, 0, Math.PI * 2);

        // Another 1.5s completes both visible cycles: the phase wraps to x=0.
        draw(3000);
        expect(arcSpy).toHaveBeenLastCalledWith(0, expect.any(Number), 2.5, 0, Math.PI * 2);
    });

    it('carries the animation phase across parameter changes instead of snapping back to zero', () => {
        const ctx = make2dContext();
        spyOnGetContext(ctx);
        const { callbacks } = captureAnimationFrames();
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
        const arcSpy = vi.spyOn(ctx, 'arc');

        const { rerender } = render(<ModulationLFO rate={1} depth={0.5} shape="sine" width={20} height={20} />);
        const firstDraw = callbacks.at(0);
        if (!firstDraw) {
            throw new Error('Expected the effect to schedule a draw frame');
        }
        firstDraw(1000);
        expect(arcSpy).toHaveBeenLastCalledWith(0, expect.any(Number), 2.5, 0, Math.PI * 2);

        // Turn the rate knob: the effect re-runs, and a clock restarted at
        // `performance.now()` on each re-run snapped the wave back to phase
        // zero mid-turn. The restarted draw carries the phase forward instead.
        nowSpy.mockReturnValue(1500);
        rerender(<ModulationLFO rate={2} depth={0.5} shape="sine" width={20} height={20} />);
        const restartedDraw = callbacks.at(-1);
        if (!restartedDraw) {
            throw new Error('Expected the restart to schedule a fresh draw frame');
        }
        restartedDraw(1500);

        // 0.5s elapsed at the new 2Hz rate → phase 1.0 of 2 visible cycles →
        // x=10, not the phase-zero x=0 of a restarted clock.
        expect(arcSpy).toHaveBeenLastCalledWith(10, expect.any(Number), 2.5, 0, Math.PI * 2);
        nowSpy.mockRestore();
    });

    it('schedules the next animation frame after drawing and cancels it on unmount', () => {
        const ctx = make2dContext();
        spyOnGetContext(ctx);
        const { callbacks, rafSpy } = captureAnimationFrames();
        const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

        const { unmount } = render(<ModulationLFO rate={1} depth={0.5} shape="sine" width={20} height={20} />);
        expect(rafSpy).toHaveBeenCalledTimes(1);

        const draw = callbacks.at(0);
        if (!draw) {
            throw new Error('Expected the effect to schedule a draw frame');
        }
        draw(0);
        expect(rafSpy).toHaveBeenCalledTimes(2);

        unmount();
        expect(cancelSpy).toHaveBeenCalledWith(2);
    });

    it('does not schedule animation when the canvas has no 2d context', () => {
        spyOnGetContext(null);
        const { rafSpy } = captureAnimationFrames();

        render(<ModulationLFO rate={1} depth={0.5} shape="sine" width={20} height={20} />);

        expect(rafSpy).not.toHaveBeenCalled();
    });

    it('falls back to sine shape and the default backing size when omitted', () => {
        const { container } = render(<ModulationLFO rate={1} depth={0.5} />);
        const canvas = container.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError('Expected a ModulationLFO canvas');
        }

        expect(canvas.width).toBe(200);
        expect(canvas.height).toBe(60);
        expect(canvas).toHaveAttribute('aria-label', 'LFO modulation: sine at 1.0 Hz');
    });

    it('falls back to a 1x backing scale when devicePixelRatio is unavailable', () => {
        const ctx = make2dContext();
        const scaleSpy = vi.spyOn(ctx, 'scale');
        spyOnGetContext(ctx);
        vi.stubGlobal('devicePixelRatio', 0);

        const { container } = render(<ModulationLFO rate={1} depth={0.5} shape="sine" width={20} height={20} />);
        const canvas = container.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError('Expected a ModulationLFO canvas');
        }

        expect(canvas.width).toBe(20);
        expect(scaleSpy).toHaveBeenCalledWith(1, 1);
    });
});

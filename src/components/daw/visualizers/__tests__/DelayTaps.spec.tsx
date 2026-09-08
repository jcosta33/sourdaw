import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DelayTaps } from '../DelayTaps';

type GetContext2d = (contextId: '2d', options?: CanvasRenderingContext2DSettings) => CanvasRenderingContext2D | null;

const spyOnGetContext = (ctx: CanvasRenderingContext2D): void => {
    const proto: { getContext: GetContext2d } = HTMLCanvasElement.prototype;
    vi.spyOn(proto, 'getContext').mockReturnValue(ctx);
};

type PointerCaptureSpy = {
    capturedPointerId: number | null;
    events: string[];
};

const installPointerCaptureSpy = (element: HTMLElement): PointerCaptureSpy => {
    const state: PointerCaptureSpy = { capturedPointerId: null, events: [] };
    Object.defineProperty(element, 'setPointerCapture', {
        configurable: true,
        value: vi.fn((pointerId: number) => {
            state.capturedPointerId = pointerId;
            state.events.push(`set:${pointerId}`);
        }),
    });
    Object.defineProperty(element, 'releasePointerCapture', {
        configurable: true,
        value: vi.fn((pointerId: number) => {
            if (state.capturedPointerId === pointerId) {
                state.capturedPointerId = null;
            }
            state.events.push(`release:${pointerId}`);
        }),
    });
    return state;
};

const getCanvas = (container: HTMLElement): HTMLCanvasElement => {
    const canvas = container.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
        throw new TypeError('Expected a DelayTaps canvas');
    }
    installPointerCaptureSpy(canvas);
    return canvas;
};

// Props: time=250ms, feedback=0.5, mix=0.5, width=200 (default), height=50 (default).
// pad=6, plotW=188, plotH=38 (see DelayTaps.tsx lines 67-102):
//   maxTaps = min(12, max(2, floor(2000/250))) = 8
//   firstTapX = pad + plotW/maxTaps = 6 + 188/8 = 29.5
//   firstTapAmplitude = mix = 0.5
//   envelopeY = pad + plotH*(1-0.5) = 6 + 19 = 25
// jsdom's getBoundingClientRect is all-zero so client coords map 1:1 to canvas coords.
const defaultProps = { time: 250, feedback: 0.5, mix: 0.5 };
const FIRST_TAP_X = 29.5;
const ENVELOPE_Y = 25;

describe('DelayTaps', () => {
    it('should render canvas', () => {
        const { container } = render(<DelayTaps {...defaultProps} />);
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });

    it('paints the drag hint only when interactive', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const fillTextSpy = vi.spyOn(ctx, 'fillText');
        spyOnGetContext(ctx);

        const { rerender, container } = render(<DelayTaps {...defaultProps} />);
        expect(fillTextSpy).not.toHaveBeenCalledWith('drag to adjust', expect.any(Number), expect.any(Number));

        rerender(<DelayTaps {...defaultProps} onParamChange={vi.fn()} />);
        expect(fillTextSpy).toHaveBeenCalledWith('drag to adjust', expect.any(Number), expect.any(Number));

        expect(container.querySelector('canvas')).toHaveAttribute('aria-label', 'Delay tap pattern');
        vi.restoreAllMocks();
    });

    it('drags near the first tap to change the delay time', () => {
        const onParamChange = vi.fn();
        const { container } = render(<DelayTaps {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: FIRST_TAP_X, clientY: 5, pointerId: 1 });
        expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
        expect(canvas.style.cursor).toBe('grabbing');

        // mx=100 -> xRatio=(100-6)/188=0.5 -> newTime=1+0.5*1999=1000.5
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: 5, pointerId: 1 });
        const lastCall = onParamChange.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe('delay-time');
        expect(lastCall?.[1]).toBeCloseTo(1000.5, 1);

        fireEvent.pointerUp(canvas, { pointerId: 1 });
        expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1);
        expect(canvas.style.cursor).toBe('grab');
    });

    it('clamps the delay time drag to the 1..2000ms range', () => {
        const onParamChange = vi.fn();
        const { container } = render(<DelayTaps {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: FIRST_TAP_X, clientY: 5, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: -100, clientY: 5, pointerId: 1 });
        expect(onParamChange).toHaveBeenCalledWith('delay-time', 1);

        onParamChange.mockClear();
        fireEvent.pointerMove(canvas, { clientX: 1000, clientY: 5, pointerId: 1 });
        expect(onParamChange).toHaveBeenCalledWith('delay-time', 2000);
    });

    it('drags near the decay envelope to change feedback', () => {
        const onParamChange = vi.fn();
        const { container } = render(<DelayTaps {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: 100, clientY: ENVELOPE_Y, pointerId: 2 });
        // my=25 -> yRatio=1-(25-6)/38=0.5 -> newFeedback=0.5
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: 25, pointerId: 2 });

        const lastCall = onParamChange.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe('delay-feedback');
        expect(lastCall?.[1]).toBeCloseTo(0.5, 1);
    });

    it('clamps the feedback drag to the 0..0.95 range', () => {
        const onParamChange = vi.fn();
        const { container } = render(<DelayTaps {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: 100, clientY: ENVELOPE_Y, pointerId: 2 });
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: -100, pointerId: 2 });
        expect(onParamChange).toHaveBeenCalledWith('delay-feedback', 0.95);

        onParamChange.mockClear();
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: 200, pointerId: 2 });
        expect(onParamChange).toHaveBeenCalledWith('delay-feedback', 0);
    });

    it('targets feedback near the envelope line even when feedback is zero', () => {
        // When feedback is 0 and mix is 0.8:
        // firstTapX = 6 + (250 / 2000) * 188 = 29.5
        // firstTapAmplitude = mix = 0.8 (envelopeY = 6 + 38 - 30.4 = 13.6).
        // If mutated to mix * feedback: firstTapAmplitude = 0 (envelopeY = 44).
        // At clientX = 50, clientY = 14:
        //   distToTap = |50 - 29.5| = 20.5 (>= 20)
        //   distToEnvelope = |14 - 13.6| = 0.4 (< 20)
        // Correct code selects 'feedback'.
        // Mutated code has distToEnvelope = |14 - 44| = 30 (>= 20); tie-breaker 20.5 < 30 selects 'time'.
        const onParamChange = vi.fn();
        const { container } = render(<DelayTaps time={250} feedback={0} mix={0.8} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: 50, clientY: 14, pointerId: 10 });
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 20, pointerId: 10 });

        const lastCall = onParamChange.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe('delay-feedback');
    });

    it('falls back to whichever axis is closer when the press lands far from both hit zones', () => {
        // mx=70 -> distToTap=|70-29.5|=40.5; my=90 -> distToEnvelope=|90-25|=65.
        // Neither is within the 20px hit radius, so the tie-break picks the closer axis (time).
        const timeOnParamChange = vi.fn();
        const { container: timeContainer } = render(<DelayTaps {...defaultProps} onParamChange={timeOnParamChange} />);
        const timeCanvas = getCanvas(timeContainer);
        fireEvent.pointerDown(timeCanvas, { clientX: 70, clientY: 90, pointerId: 3 });
        fireEvent.pointerMove(timeCanvas, { clientX: 100, clientY: 90, pointerId: 3 });
        expect(timeOnParamChange.mock.calls.at(-1)?.[0]).toBe('delay-time');

        // mx=90 -> distToTap=60.5; my=60 -> distToEnvelope=35. Feedback is the closer axis.
        const feedbackOnParamChange = vi.fn();
        const { container: feedbackContainer } = render(
            <DelayTaps {...defaultProps} onParamChange={feedbackOnParamChange} />
        );
        const feedbackCanvas = getCanvas(feedbackContainer);
        fireEvent.pointerDown(feedbackCanvas, { clientX: 90, clientY: 60, pointerId: 4 });
        fireEvent.pointerMove(feedbackCanvas, { clientX: 90, clientY: 30, pointerId: 4 });
        expect(feedbackOnParamChange.mock.calls.at(-1)?.[0]).toBe('delay-feedback');
    });

    it('draws the first wet tap at mix amplitude when feedback is zero', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const fillRectSpy = vi.spyOn(ctx, 'fillRect');
        spyOnGetContext(ctx);

        render(<DelayTaps time={250} feedback={0} mix={0.8} />);

        // Dry bar is drawn with dryBarH = 38 * 0.9 = 34.2.
        // Tap 1 is drawn with barH = 0.8 * 38 = 30.4, plus 1px top highlight.
        // When feedback is 0, no subsequent wet taps are drawn.
        const wetBarCalls = fillRectSpy.mock.calls.filter(([, , , height]) => height !== 34.2 && height !== 1);
        expect(wetBarCalls).toHaveLength(1);
        const firstWetBar = wetBarCalls[0];
        if (!firstWetBar) {
            throw new TypeError('Expected at least one wet bar');
        }
        expect(firstWetBar[3]).toBeCloseTo(30.4, 2);

        vi.restoreAllMocks();
    });

    it('decays subsequent taps by feedback while keeping first tap at mix amplitude', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const fillRectSpy = vi.spyOn(ctx, 'fillRect');
        spyOnGetContext(ctx);

        render(<DelayTaps time={250} feedback={0.5} mix={0.8} />);

        // Dry bar height = 34.2. Tap highlights have height = 1.
        // Tap 1: amplitude 0.8 -> barH = 30.4
        // Tap 2: amplitude 0.4 -> barH = 15.2
        // Tap 3: amplitude 0.2 -> barH = 7.6
        const wetBarCalls = fillRectSpy.mock.calls.filter(([, , , height]) => height !== 34.2 && height !== 1);
        const [tap1, tap2, tap3] = wetBarCalls;
        if (!tap1 || !tap2 || !tap3) {
            throw new TypeError('Expected at least three wet bars');
        }
        expect(tap1[3]).toBeCloseTo(30.4, 2);
        expect(tap2[3]).toBeCloseTo(15.2, 2);
        expect(tap3[3]).toBeCloseTo(7.6, 2);

        vi.restoreAllMocks();
    });

    it('connects the decay envelope line to the first wet tap when feedback is zero', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const lineToSpy = vi.spyOn(ctx, 'lineTo');
        spyOnGetContext(ctx);

        render(<DelayTaps time={250} feedback={0} mix={0.8} />);

        // When feedback is 0, tap 1 is drawn at xPos = 29.5, yPos = pad + plotH - 0.8 * plotH = 13.6.
        // If amplitude was computed as mix * feedback, tap 1 has amplitude 0 < 0.01 and breaks before calling lineTo.
        expect(lineToSpy).toHaveBeenCalledWith(29.5, expect.closeTo(13.6, 1));

        vi.restoreAllMocks();
    });

    it('stops reporting param changes once the pointer is released', () => {
        const onParamChange = vi.fn();
        const { container } = render(<DelayTaps {...defaultProps} onParamChange={onParamChange} />);
        const canvas = getCanvas(container);

        fireEvent.pointerDown(canvas, { clientX: FIRST_TAP_X, clientY: 5, pointerId: 5 });
        fireEvent.pointerUp(canvas, { pointerId: 5 });

        onParamChange.mockClear();
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: 5, pointerId: 5 });
        expect(onParamChange).not.toHaveBeenCalled();
    });

    it('does not wire pointer handlers when non-interactive', () => {
        const { container } = render(<DelayTaps {...defaultProps} />);
        const canvas = container.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError('Expected a DelayTaps canvas');
        }

        expect(() => {
            fireEvent.pointerDown(canvas, { clientX: FIRST_TAP_X, clientY: 5, pointerId: 6 });
            fireEvent.pointerMove(canvas, { clientX: 100, clientY: 5, pointerId: 6 });
            fireEvent.pointerUp(canvas, { pointerId: 6 });
        }).not.toThrow();
    });
});

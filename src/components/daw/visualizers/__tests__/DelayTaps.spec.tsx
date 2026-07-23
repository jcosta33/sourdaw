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
//   firstTapAmplitude = mix*feedback = 0.25
//   envelopeY = pad + plotH*(1-0.25) = 6 + 28.5 = 34.5
// jsdom's getBoundingClientRect is all-zero so client coords map 1:1 to canvas coords.
const defaultProps = { time: 250, feedback: 0.5, mix: 0.5 };
const FIRST_TAP_X = 29.5;
const ENVELOPE_Y = 34.5;

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

    it('falls back to whichever axis is closer when the press lands far from both hit zones', () => {
        // mx=70 -> distToTap=|70-29.5|=40.5; my=90 -> distToEnvelope=|90-34.5|=55.5.
        // Neither is within the 20px hit radius, so the tie-break picks the closer axis (time).
        const timeOnParamChange = vi.fn();
        const { container: timeContainer } = render(<DelayTaps {...defaultProps} onParamChange={timeOnParamChange} />);
        const timeCanvas = getCanvas(timeContainer);
        fireEvent.pointerDown(timeCanvas, { clientX: 70, clientY: 90, pointerId: 3 });
        fireEvent.pointerMove(timeCanvas, { clientX: 100, clientY: 90, pointerId: 3 });
        expect(timeOnParamChange.mock.calls.at(-1)?.[0]).toBe('delay-time');

        // mx=90 -> distToTap=60.5; my=60 -> distToEnvelope=25.5. Feedback is the closer axis.
        const feedbackOnParamChange = vi.fn();
        const { container: feedbackContainer } = render(
            <DelayTaps {...defaultProps} onParamChange={feedbackOnParamChange} />
        );
        const feedbackCanvas = getCanvas(feedbackContainer);
        fireEvent.pointerDown(feedbackCanvas, { clientX: 90, clientY: 60, pointerId: 4 });
        fireEvent.pointerMove(feedbackCanvas, { clientX: 90, clientY: 30, pointerId: 4 });
        expect(feedbackOnParamChange.mock.calls.at(-1)?.[0]).toBe('delay-feedback');
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

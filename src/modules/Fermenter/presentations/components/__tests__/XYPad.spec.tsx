import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { XYPad } from '../XYPad';

// jsdom's getBoundingClientRect returns zeros; the pointer handler divides by
// rect.width/height, so patch it to a non-zero box to exercise the normalisation.
function patchRect(width: number, height: number): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width,
        height,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
}

describe('XYPad', () => {
    let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

    beforeEach(() => {
        originalGetContext = HTMLCanvasElement.prototype.getContext;
    });

    afterEach(() => {
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        vi.restoreAllMocks();
    });

    describe('canvas element', () => {
        it('renders a canvas sized to the prop and with grab cursor + touchAction none', () => {
            const { container } = render(
                <XYPad xValue={0.5} yValue={0.5} onXChange={vi.fn()} onYChange={vi.fn()} size={80} />
            );
            const canvas = container.querySelector('canvas')!;
            expect(canvas.style.width).toBe('80px');
            expect(canvas.style.height).toBe('80px');
            expect(canvas.style.cursor).toBe('grab');
            expect(canvas.style.touchAction).toBe('none');
        });

        it('defaults labels to X/Y when none are provided', () => {
            // labels are drawn onto the canvas via fillText; capture them.
            const texts: string[] = [];
            const grad = { addColorStop: () => {} };
            const ctx = {
                canvas: {},
                setTransform: () => {},
                scale: () => {},
                clearRect: () => {},
                createLinearGradient: () => grad,
                createRadialGradient: () => grad,
                fillRect: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                stroke: () => {},
                fill: () => {},
                arc: () => {},
                fillText: (t: string) => texts.push(t),
                save: () => {},
                translate: () => {},
                rotate: () => {},
                restore: () => {},
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 1,
                font: '',
                textAlign: 'start',
            };
            // @ts-expect-error — jsdom stub covers only the '2d' path; overloaded return type intentionally incomplete (mirrors setupTests.ts)
            HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
                if (id === '2d') {
                    (ctx as unknown as { canvas: HTMLCanvasElement }).canvas = this;
                    return ctx;
                }
                return null;
            };
            render(<XYPad xValue={0.5} yValue={0.5} onXChange={vi.fn()} onYChange={vi.fn()} size={80} />);
            // default xLabel='X', yLabel='Y' are both drawn
            expect(texts).toContain('X');
            expect(texts).toContain('Y');
        });

        it('draws custom x/y labels when provided', () => {
            const texts: string[] = [];
            const grad = { addColorStop: () => {} };
            const ctx = {
                canvas: {},
                setTransform: () => {},
                scale: () => {},
                clearRect: () => {},
                createLinearGradient: () => grad,
                createRadialGradient: () => grad,
                fillRect: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                stroke: () => {},
                fill: () => {},
                arc: () => {},
                fillText: (t: string) => texts.push(t),
                save: () => {},
                translate: () => {},
                rotate: () => {},
                restore: () => {},
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 1,
                font: '',
                textAlign: 'start',
            };
            // @ts-expect-error — jsdom stub covers only the '2d' path; overloaded return type intentionally incomplete (mirrors setupTests.ts)
            HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
                if (id === '2d') {
                    (ctx as unknown as { canvas: HTMLCanvasElement }).canvas = this;
                    return ctx;
                }
                return null;
            };
            render(
                <XYPad
                    xValue={0.5}
                    yValue={0.5}
                    xLabel="Cutoff"
                    yLabel="Reso"
                    onXChange={vi.fn()}
                    onYChange={vi.fn()}
                    size={80}
                />
            );
            expect(texts).toContain('Cutoff');
            expect(texts).toContain('Reso');
            expect(texts).not.toContain('X');
            expect(texts).not.toContain('Y');
        });
    });

    describe('pointer value mapping (updateFromPointer)', () => {
        it('normalises a pointer to x in [0,1] and y inverted, on pointer down', () => {
            patchRect(100, 100);
            const onXChange = vi.fn();
            const onYChange = vi.fn();
            const { container } = render(
                <XYPad xValue={0} yValue={0} onXChange={onXChange} onYChange={onYChange} size={100} />
            );
            const canvas = container.querySelector('canvas')!;
            // click at (30, 25) in a 100×100 box → x=0.30, y=1-0.25=0.75
            fireEvent.pointerDown(canvas, { clientX: 30, clientY: 25, pointerId: 1 });
            expect(onXChange).toHaveBeenLastCalledWith(0.3);
            expect(onYChange).toHaveBeenLastCalledWith(0.75);
        });

        it('clamps an out-of-range pointer to the [0,1] bounds', () => {
            patchRect(100, 100);
            const onXChange = vi.fn();
            const onYChange = vi.fn();
            const { container } = render(
                <XYPad xValue={0} yValue={0} onXChange={onXChange} onYChange={onYChange} size={100} />
            );
            const canvas = container.querySelector('canvas')!;
            // top-left corner (negative-ish) → clamped to (0, 1); bottom-right → (1, 0)
            fireEvent.pointerDown(canvas, { clientX: -50, clientY: -50, pointerId: 1 });
            expect(onXChange).toHaveBeenLastCalledWith(0);
            expect(onYChange).toHaveBeenLastCalledWith(1);

            fireEvent.pointerDown(canvas, { clientX: 200, clientY: 200, pointerId: 2 });
            expect(onXChange).toHaveBeenLastCalledWith(1);
            expect(onYChange).toHaveBeenLastCalledWith(0);
        });

        it('does not emit on pointer move before a pointer down (drag not started)', () => {
            patchRect(100, 100);
            const onXChange = vi.fn();
            const onYChange = vi.fn();
            const { container } = render(
                <XYPad xValue={0.5} yValue={0.5} onXChange={onXChange} onYChange={onYChange} size={100} />
            );
            const canvas = container.querySelector('canvas')!;
            fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
            expect(onXChange).not.toHaveBeenCalled();
            expect(onYChange).not.toHaveBeenCalled();
        });

        it('emits on pointer move only after a pointer down starts the drag', () => {
            patchRect(100, 100);
            const onXChange = vi.fn();
            const onYChange = vi.fn();
            const { container } = render(
                <XYPad xValue={0} yValue={0} onXChange={onXChange} onYChange={onYChange} size={100} />
            );
            const canvas = container.querySelector('canvas')!;
            fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
            fireEvent.pointerMove(canvas, { clientX: 60, clientY: 80, pointerId: 1 });
            expect(onXChange).toHaveBeenLastCalledWith(0.6);
            // 1 - 80/100 = 0.1999... due to float; assert closeness
            const lastY = onYChange.mock.calls.at(-1)![0];
            expect(lastY).toBeCloseTo(0.2, 10);
        });

        it('stops emitting after pointer up ends the drag', () => {
            patchRect(100, 100);
            const onXChange = vi.fn();
            const onYChange = vi.fn();
            const { container } = render(
                <XYPad xValue={0} yValue={0} onXChange={onXChange} onYChange={onYChange} size={100} />
            );
            const canvas = container.querySelector('canvas')!;
            fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
            fireEvent.pointerUp(canvas, { pointerId: 1 });
            fireEvent.pointerMove(canvas, { clientX: 90, clientY: 90, pointerId: 1 });
            // last call is still from the pointerDown, not the post-up move
            expect(onXChange).toHaveBeenCalledTimes(1);
        });

        it('stops emitting after pointer cancel ends the drag', () => {
            patchRect(100, 100);
            const onXChange = vi.fn();
            const onYChange = vi.fn();
            const { container } = render(
                <XYPad xValue={0} yValue={0} onXChange={onXChange} onYChange={onYChange} size={100} />
            );
            const canvas = container.querySelector('canvas')!;
            fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
            fireEvent.pointerCancel(canvas, { pointerId: 1 });
            fireEvent.pointerMove(canvas, { clientX: 90, clientY: 90, pointerId: 1 });
            // only the pointerDown emitted; the post-cancel move is suppressed
            expect(onXChange).toHaveBeenCalledTimes(1);
        });
    });

    describe('puck position render', () => {
        it('draws the puck at xValue*size and (1-yValue)*size', () => {
            const arcs: Array<[number, number, number]> = [];
            const grad = { addColorStop: () => {} };
            const ctx = {
                canvas: {},
                setTransform: () => {},
                scale: () => {},
                clearRect: () => {},
                createLinearGradient: () => grad,
                createRadialGradient: () => grad,
                fillRect: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                stroke: () => {},
                fill: () => {},
                arc: (x: number, y: number, r: number) => arcs.push([x, y, r]),
                fillText: () => {},
                save: () => {},
                translate: () => {},
                rotate: () => {},
                restore: () => {},
                fillStyle: '',
                strokeStyle: '',
                lineWidth: 1,
                font: '',
                textAlign: 'start',
            };
            // @ts-expect-error — jsdom stub covers only the '2d' path; overloaded return type intentionally incomplete (mirrors setupTests.ts)
            HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, id: string) {
                if (id === '2d') {
                    (ctx as unknown as { canvas: HTMLCanvasElement }).canvas = this;
                    return ctx;
                }
                return null;
            };
            // size=100, xValue=0.4, yValue=0.3 → puckX=40, puckY=(1-0.3)*100=70
            render(<XYPad xValue={0.4} yValue={0.3} onXChange={vi.fn()} onYChange={vi.fn()} size={100} />);
            // the puck arc (radius 4.5) is drawn at (40, 70)
            expect(arcs).toContainEqual([40, 70, 4.5]);
        });
    });
});

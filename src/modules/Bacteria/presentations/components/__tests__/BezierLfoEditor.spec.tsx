import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { BezierLfoEditor, DEFAULT_POINTS } from '../BezierLfoEditor';

function mockRect(canvas: HTMLElement): void {
    canvas.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
}

const testPoints = [
    { pos: { x: 0, y: 0.5 }, cp1: { x: 0, y: 0.5 }, cp2: { x: 0.2, y: 0.5 } },
    { pos: { x: 1, y: 0.5 }, cp1: { x: 0.8, y: 0.5 }, cp2: { x: 1, y: 0.5 } },
];

describe('BezierLfoEditor', () => {
    it('should render', () => {
        const { container } = render(<BezierLfoEditor width={120} height={80} points={[]} onPointsChange={vi.fn()} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('keeps every default control-handle x within the reachable [0,1] range', () => {
        for (const point of DEFAULT_POINTS) {
            for (const handle of [point.cp1, point.cp2, point.pos]) {
                expect(handle.x).toBeGreaterThanOrEqual(0);
                expect(handle.x).toBeLessThanOrEqual(1);
            }
        }
    });

    it('clears the active drag on pointercancel so later moves are ignored', () => {
        const onPointsChange = vi.fn();
        const { container } = render(
            <BezierLfoEditor width={100} height={100} points={testPoints} onPointsChange={onPointsChange} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);

        fireEvent.pointerDown(canvas, { clientX: 0, clientY: 50, pointerId: 1 });
        fireEvent.pointerCancel(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 10, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onPointsChange).not.toHaveBeenCalled();
    });
});

describe('BezierLfoEditor — canvas attributes and label', () => {
    it('sizes the canvas to the provided width and height', () => {
        const { container } = render(<BezierLfoEditor width={200} height={120} points={[]} onPointsChange={vi.fn()} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.width).toBe(200);
        expect(canvas?.height).toBe(120);
    });

    it('shows "LFO Shape" label when tempoSync is false', () => {
        const { container } = render(<BezierLfoEditor width={100} height={100} points={[]} onPointsChange={vi.fn()} />);
        expect(container.textContent).toContain('LFO Shape');
    });

    it('shows "LFO (Tempo Sync)" label when tempoSync is true', () => {
        const { container } = render(
            <BezierLfoEditor width={100} height={100} points={[]} onPointsChange={vi.fn()} tempoSync />
        );
        expect(container.textContent).toContain('LFO (Tempo Sync)');
    });
});

describe('BezierLfoEditor — drag interaction', () => {
    it('commits points via onPointsChange when a drag completes', () => {
        const onPointsChange = vi.fn();
        const { container } = render(
            <BezierLfoEditor width={100} height={100} points={testPoints} onPointsChange={onPointsChange} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);

        // First point pos at (0, 0.5) → canvas (0, 50). Drag to (50, 25).
        fireEvent.pointerDown(canvas, { clientX: 0, clientY: 50, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 25, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onPointsChange).toHaveBeenCalledTimes(1);
        const committed = onPointsChange.mock.calls[0]?.[0];
        // fromCanvas(50, 25, 100, 100) = { x: 0.5, y: 0.75 }
        expect(committed[0].pos).toEqual({ x: 0.5, y: 0.75 });
    });

    it('does not commit when pointer up without a preceding drag', () => {
        const onPointsChange = vi.fn();
        const { container } = render(
            <BezierLfoEditor width={100} height={100} points={testPoints} onPointsChange={onPointsChange} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);

        fireEvent.pointerUp(canvas, { pointerId: 1 });
        expect(onPointsChange).not.toHaveBeenCalled();
    });
});

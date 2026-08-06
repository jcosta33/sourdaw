import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { WaveshaperEditor } from '../WaveshaperEditor';

const defaultSegments = [
    {
        p0: { x: -1, y: -1 },
        p1: { x: -0.5, y: -0.5 },
        p2: { x: 0.5, y: 0.5 },
        p3: { x: 1, y: 1 },
    },
];

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

describe('WaveshaperEditor', () => {
    it('should render', () => {
        const { container } = render(
            <WaveshaperEditor width={120} height={80} segments={[]} onSegmentsChange={vi.fn()} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('redraws on a dep change but not on an unchanged re-render', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const clearSpy = vi.spyOn(ctx, 'clearRect');

        const { rerender } = render(
            <WaveshaperEditor width={120} height={80} segments={[]} onSegmentsChange={vi.fn()} />
        );
        const afterMount = clearSpy.mock.calls.length;
        expect(afterMount).toBeGreaterThan(0);

        rerender(<WaveshaperEditor width={200} height={80} segments={[]} onSegmentsChange={vi.fn()} />);
        const afterWidthChange = clearSpy.mock.calls.length;
        expect(afterWidthChange).toBe(afterMount + 1);

        rerender(<WaveshaperEditor width={200} height={80} segments={[]} onSegmentsChange={vi.fn()} />);
        expect(clearSpy.mock.calls.length).toBe(afterWidthChange);

        clearSpy.mockRestore();
    });

    it('clears the active drag on pointercancel', () => {
        const onSegmentsChange = vi.fn();
        const { container } = render(
            <WaveshaperEditor width={100} height={100} segments={defaultSegments} onSegmentsChange={onSegmentsChange} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);

        fireEvent.pointerDown(canvas, { clientX: 25, clientY: 75, pointerId: 1 });
        fireEvent.pointerCancel(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onSegmentsChange).not.toHaveBeenCalled();
    });
});

describe('WaveshaperEditor — canvas attributes', () => {
    it('sizes the canvas to the provided width and height', () => {
        const { container } = render(
            <WaveshaperEditor width={150} height={100} segments={[]} onSegmentsChange={vi.fn()} />
        );
        const canvas = container.querySelector('canvas');
        expect(canvas?.width).toBe(150);
        expect(canvas?.height).toBe(100);
    });
});

describe('WaveshaperEditor — drag interaction', () => {
    it('commits segments via onSegmentsChange when a drag completes', () => {
        const onSegmentsChange = vi.fn();
        const { container } = render(
            <WaveshaperEditor width={100} height={100} segments={defaultSegments} onSegmentsChange={onSegmentsChange} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);

        // p1 at (-0.5, -0.5) → canvas (25, 75). Drag it to center (50, 50).
        fireEvent.pointerDown(canvas, { clientX: 25, clientY: 75, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onSegmentsChange).toHaveBeenCalledTimes(1);
        const committed = onSegmentsChange.mock.calls[0]?.[0];
        // The dragged control point p1 should have moved
        expect(committed[0].p1).not.toEqual({ x: -0.5, y: -0.5 });
        // fromCanvas(50, 50, 100, 100) = { x: 0, y: 0 }
        expect(committed[0].p1).toEqual({ x: 0, y: 0 });
    });

    it('does not commit when pointer up without a preceding drag', () => {
        const onSegmentsChange = vi.fn();
        const { container } = render(
            <WaveshaperEditor width={100} height={100} segments={defaultSegments} onSegmentsChange={onSegmentsChange} />
        );
        const canvas = container.querySelector('canvas')!;
        mockRect(canvas);

        // pointerUp without pointerDown on a control point
        fireEvent.pointerUp(canvas, { pointerId: 1 });
        expect(onSegmentsChange).not.toHaveBeenCalled();
    });
});

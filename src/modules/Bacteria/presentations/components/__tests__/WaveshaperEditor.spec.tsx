import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { WaveshaperEditor } from '../WaveshaperEditor';

describe('WaveshaperEditor', () => {
    it('should render', () => {
        const { container } = render(
            <WaveshaperEditor width={120} height={80} segments={[]} onSegmentsChange={vi.fn()} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    // Regression: the draw effect previously had no dependency array and redrew on
    // every re-render. With [segments,width,height] deps it must redraw when a dep
    // changes (width) but NOT on a re-render where the deps are unchanged.
    it('redraws on a dep change but not on an unchanged re-render', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const clearSpy = vi.spyOn(ctx, 'clearRect');

        const { rerender } = render(
            <WaveshaperEditor width={120} height={80} segments={[]} onSegmentsChange={vi.fn()} />
        );
        const afterMount = clearSpy.mock.calls.length;
        expect(afterMount).toBeGreaterThan(0);

        // Changing width (a dep) must redraw.
        rerender(<WaveshaperEditor width={200} height={80} segments={[]} onSegmentsChange={vi.fn()} />);
        const afterWidthChange = clearSpy.mock.calls.length;
        expect(afterWidthChange).toBe(afterMount + 1);

        // Re-rendering with identical width/height/empty-segments must NOT redraw.
        // With the old no-dependency-array effect this count would keep climbing.
        rerender(<WaveshaperEditor width={200} height={80} segments={[]} onSegmentsChange={vi.fn()} />);
        expect(clearSpy.mock.calls.length).toBe(afterWidthChange);

        clearSpy.mockRestore();
    });

    // Regression: a cancelled gesture clears the drag so a later move cannot commit.
    it('clears the active drag on pointercancel', () => {
        const onSegmentsChange = vi.fn();
        const { container } = render(
            <WaveshaperEditor
                width={100}
                height={100}
                segments={[
                    {
                        p0: { x: -1, y: -1 },
                        p1: { x: -0.5, y: -0.5 },
                        p2: { x: 0.5, y: 0.5 },
                        p3: { x: 1, y: 1 },
                    },
                ]}
                onSegmentsChange={onSegmentsChange}
            />
        );
        const canvas = container.querySelector('canvas')!;
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

        // p1 = (-0.5,-0.5) → canvas ((−0.5+1)*0.5*100, (1−(−0.5+1)*0.5)*100) = (25, 75).
        fireEvent.pointerDown(canvas, { clientX: 25, clientY: 75, pointerId: 1 });
        fireEvent.pointerCancel(canvas, { pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onSegmentsChange).not.toHaveBeenCalled();
    });
});

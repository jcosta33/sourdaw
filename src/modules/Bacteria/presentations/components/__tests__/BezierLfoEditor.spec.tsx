import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { BezierLfoEditor, DEFAULT_POINTS } from '../BezierLfoEditor';

describe('BezierLfoEditor', () => {
    it('should render', () => {
        const { container } = render(<BezierLfoEditor width={120} height={80} points={[]} onPointsChange={vi.fn()} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    // Regression: default control handles must stay inside [0,1] because
    // fromCanvas() clamps every dragged handle to that range — a default outside
    // it (e.g. x:-0.05 / x:1.05) becomes unreachable once the user grabs it.
    it('keeps every default control-handle x within the reachable [0,1] range', () => {
        for (const point of DEFAULT_POINTS) {
            for (const handle of [point.cp1, point.cp2, point.pos]) {
                expect(handle.x).toBeGreaterThanOrEqual(0);
                expect(handle.x).toBeLessThanOrEqual(1);
            }
        }
    });

    // Regression: a cancelled gesture (e.g. browser steals the pointer) must clear
    // the drag so a later move that is not part of any gesture cannot mutate points.
    it('clears the active drag on pointercancel so later moves are ignored', () => {
        const onPointsChange = vi.fn();
        const { container } = render(
            <BezierLfoEditor
                width={100}
                height={100}
                points={[
                    { pos: { x: 0, y: 0.5 }, cp1: { x: 0, y: 0.5 }, cp2: { x: 0.2, y: 0.5 } },
                    { pos: { x: 1, y: 0.5 }, cp1: { x: 0.8, y: 0.5 }, cp2: { x: 1, y: 0.5 } },
                ]}
                onPointsChange={onPointsChange}
            />
        );
        const canvas = container.querySelector('canvas')!;
        canvas.getBoundingClientRect = () =>
            ({
                left: 0,
                top: 0,
                width: 100,
                height: 100,
                right: 100,
                bottom: 100,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;

        // Grab the first point (canvas x=0, y=(1-0.5)*100=50).
        fireEvent.pointerDown(canvas, { clientX: 0, clientY: 50, pointerId: 1 });
        // Cancel the gesture.
        fireEvent.pointerCancel(canvas, { pointerId: 1 });
        // A subsequent move (not part of a gesture) must not commit a change.
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 10, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onPointsChange).not.toHaveBeenCalled();
    });
});

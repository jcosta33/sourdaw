import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/BacteriaPatch';
import { XYMorphPad } from '../XYMorphPad';

function mockRect(el: HTMLElement, w = 120, h = 120): void {
    el.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: w,
        height: h,
        right: w,
        bottom: h,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
}

describe('XYMorphPad', () => {
    it('should render', () => {
        const { container } = render(
            <XYMorphPad
                x={0.5}
                y={0.5}
                onChangeX={vi.fn()}
                onChangeY={vi.fn()}
                snapshots={DEFAULT_PATCH.snapshots}
                width={120}
                height={120}
            />
        );
        expect(container.firstChild).toBeTruthy();
    });

    it('stops updating the position after pointercancel', () => {
        const onChangeX = vi.fn();
        const onChangeY = vi.fn();
        const { container } = render(
            <XYMorphPad
                x={0.5}
                y={0.5}
                onChangeX={onChangeX}
                onChangeY={onChangeY}
                snapshots={DEFAULT_PATCH.snapshots}
                width={120}
                height={120}
            />
        );
        const pad = container.firstChild as HTMLElement;
        mockRect(pad);
        fireEvent.pointerDown(pad, { clientX: 60, clientY: 60, pointerId: 1 });
        onChangeX.mockClear();
        onChangeY.mockClear();
        fireEvent.pointerCancel(pad, { pointerId: 1 });
        fireEvent.pointerMove(pad, { clientX: 10, clientY: 90, pointerId: 1 });
        expect(onChangeX).not.toHaveBeenCalled();
        expect(onChangeY).not.toHaveBeenCalled();
    });
});

describe('XYMorphPad — pointer drag', () => {
    it('fires onChangeX and onChangeY with normalized coordinates on drag', () => {
        const onChangeX = vi.fn();
        const onChangeY = vi.fn();
        const { container } = render(
            <XYMorphPad
                x={0.5}
                y={0.5}
                onChangeX={onChangeX}
                onChangeY={onChangeY}
                snapshots={DEFAULT_PATCH.snapshots}
                width={100}
                height={100}
            />
        );
        const pad = container.firstChild as HTMLElement;
        mockRect(pad, 100, 100);
        // Drag to x=25, y=25 → nx=0.25, ny=1-0.25=0.75
        fireEvent.pointerDown(pad, { clientX: 50, clientY: 50, pointerId: 1 });
        fireEvent.pointerMove(pad, { clientX: 25, clientY: 25, pointerId: 1 });
        // pointerDown fires first, then pointerMove
        const xCalls = onChangeX.mock.calls.map((c) => c[0]);
        const yCalls = onChangeY.mock.calls.map((c) => c[0]);
        // Last move should produce x=0.25, y=0.75
        expect(xCalls[xCalls.length - 1]).toBeCloseTo(0.25, 5);
        expect(yCalls[yCalls.length - 1]).toBeCloseTo(0.75, 5);
    });

    it('does not fire onChange when moving without pointerDown', () => {
        const onChangeX = vi.fn();
        const { container } = render(
            <XYMorphPad
                x={0.5}
                y={0.5}
                onChangeX={onChangeX}
                onChangeY={vi.fn()}
                snapshots={DEFAULT_PATCH.snapshots}
                width={100}
                height={100}
            />
        );
        const pad = container.firstChild as HTMLElement;
        mockRect(pad, 100, 100);
        fireEvent.pointerMove(pad, { clientX: 25, clientY: 25, pointerId: 1 });
        expect(onChangeX).not.toHaveBeenCalled();
    });

    it('clamps coordinates to [0, 1]', () => {
        const onChangeX = vi.fn();
        const onChangeY = vi.fn();
        const { container } = render(
            <XYMorphPad
                x={0.5}
                y={0.5}
                onChangeX={onChangeX}
                onChangeY={onChangeY}
                snapshots={DEFAULT_PATCH.snapshots}
                width={100}
                height={100}
            />
        );
        const pad = container.firstChild as HTMLElement;
        mockRect(pad, 100, 100);
        // Drag to negative coordinates
        fireEvent.pointerDown(pad, { clientX: -10, clientY: -10, pointerId: 1 });
        const xVal = onChangeX.mock.calls[0]?.[0];
        const yVal = onChangeY.mock.calls[0]?.[0];
        expect(xVal).toBeGreaterThanOrEqual(0);
        expect(yVal).toBeLessThanOrEqual(1);
    });
});

describe('XYMorphPad — corner labels', () => {
    it('renders A, B, C, D labels for 4 snapshots', () => {
        const { container } = render(
            <XYMorphPad
                x={0.5}
                y={0.5}
                onChangeX={vi.fn()}
                onChangeY={vi.fn()}
                snapshots={DEFAULT_PATCH.snapshots}
                width={120}
                height={120}
            />
        );
        expect(container.textContent).toContain('A');
        expect(container.textContent).toContain('B');
        expect(container.textContent).toContain('C');
        expect(container.textContent).toContain('D');
    });
});

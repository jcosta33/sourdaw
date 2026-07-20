import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineMinimapResizeHandle } from '../TimelineMinimapResizeHandle';

describe('TimelineMinimapResizeHandle keyboard semantics', () => {
    const renderHandle = (height: number) => {
        const onCommit = vi.fn();
        const view = render(
            <TimelineMinimapResizeHandle
                height={height}
                persistedHeight={height}
                onPreview={vi.fn()}
                onCommit={onCommit}
                onCancel={vi.fn()}
            />
        );
        return { ...view, onCommit };
    };

    it('is a named, focusable horizontal separator with a truthful value range', () => {
        renderHandle(72);

        const handle = screen.getByRole('separator', { name: 'Resize timeline minimap' });
        expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
        expect(handle).toHaveAttribute('aria-valuemin', '28');
        expect(handle).toHaveAttribute('aria-valuemax', '160');
        expect(handle).toHaveAttribute('aria-valuenow', '72');
        expect(handle).toHaveAttribute('tabindex', '0');
        expect(handle).toHaveClass('cursor-row-resize');
    });

    it.each([
        { key: 'ArrowUp', shiftKey: false, expected: 68 },
        { key: 'ArrowDown', shiftKey: false, expected: 60 },
        { key: 'ArrowUp', shiftKey: true, expected: 65 },
        { key: 'ArrowDown', shiftKey: true, expected: 63 },
        { key: 'Home', shiftKey: false, expected: 28 },
        { key: 'End', shiftKey: false, expected: 160 },
    ])('handles $key with shift=$shiftKey', ({ key, shiftKey, expected }) => {
        const { onCommit } = renderHandle(64);
        const handle = screen.getByRole('separator');

        const dispatched = fireEvent.keyDown(handle, { key, shiftKey });

        expect(dispatched).toBe(false);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(expected);
    });

    it('clamps handled keys and leaves unrelated keys untouched', () => {
        const { rerender, onCommit } = renderHandle(159);
        const handle = screen.getByRole('separator');

        fireEvent.keyDown(handle, { key: 'ArrowUp' });
        expect(onCommit).toHaveBeenLastCalledWith(160);

        rerender(
            <TimelineMinimapResizeHandle
                height={28}
                persistedHeight={28}
                onPreview={vi.fn()}
                onCommit={onCommit}
                onCancel={vi.fn()}
            />
        );
        const dispatched = fireEvent.keyDown(handle, { key: 'PageDown' });

        expect(dispatched).toBe(true);
        expect(onCommit).toHaveBeenCalledTimes(1);
    });
});

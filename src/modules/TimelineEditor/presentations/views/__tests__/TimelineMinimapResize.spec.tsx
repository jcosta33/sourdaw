import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineMinimapResizeHandle } from '../TimelineMinimapResizeHandle';

describe('TimelineMinimapResizeHandle pointer lifecycle', () => {
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => true);

    beforeEach(() => {
        vi.clearAllMocks();
        HTMLElement.prototype.setPointerCapture = setPointerCapture;
        HTMLElement.prototype.releasePointerCapture = releasePointerCapture;
        HTMLElement.prototype.hasPointerCapture = hasPointerCapture;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const renderHandle = ({
        height = 64,
        persistedHeight = 64,
    }: {
        height?: number;
        persistedHeight?: number;
    } = {}) => {
        const onPreview = vi.fn();
        const onCommit = vi.fn();
        const onCancel = vi.fn();
        const view = render(
            <TimelineMinimapResizeHandle
                height={height}
                persistedHeight={persistedHeight}
                onPreview={onPreview}
                onCommit={onCommit}
                onCancel={onCancel}
            />
        );
        return { ...view, onPreview, onCommit, onCancel };
    };

    it('captures the primary pointer, previews continuously, and commits exactly once on release', () => {
        const { onPreview, onCommit, onCancel } = renderHandle();
        const handle = screen.getByRole('separator', { name: 'Resize timeline minimap' });

        fireEvent.pointerDown(handle, { button: 0, pointerId: 7, isPrimary: true, clientY: 100 });
        fireEvent.pointerMove(handle, { pointerId: 7, clientY: 60 });
        fireEvent.pointerMove(handle, { pointerId: 7, clientY: 57.6 });

        expect(setPointerCapture).toHaveBeenCalledWith(7);
        expect(onPreview).toHaveBeenNthCalledWith(1, 104);
        expect(onPreview).toHaveBeenNthCalledWith(2, 106);
        expect(onCommit).not.toHaveBeenCalled();

        fireEvent.pointerUp(handle, { pointerId: 7, clientY: 57.6 });
        fireEvent.lostPointerCapture(handle, { pointerId: 7 });

        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(106);
        expect(onCancel).not.toHaveBeenCalled();
        expect(releasePointerCapture).toHaveBeenCalledWith(7);
    });

    it.each(['pointerCancel', 'lostPointerCapture'] as const)('cancels without persisting on %s', (eventName) => {
        const { onPreview, onCommit, onCancel } = renderHandle();
        const handle = screen.getByRole('separator');

        fireEvent.pointerDown(handle, { button: 0, pointerId: 3, isPrimary: true, clientY: 80 });
        fireEvent.pointerMove(handle, { pointerId: 3, clientY: 40 });
        fireEvent[eventName](handle, { pointerId: 3 });

        expect(onPreview).toHaveBeenCalledWith(104);
        expect(onCommit).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('cancels and releases capture when unmounted mid-drag', () => {
        const { unmount, onCommit, onCancel } = renderHandle();
        const handle = screen.getByRole('separator');

        fireEvent.pointerDown(handle, { button: 0, pointerId: 5, isPrimary: true, clientY: 80 });
        unmount();

        expect(onCommit).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(releasePointerCapture).toHaveBeenCalledWith(5);
    });

    it('cancels an active preview when newer persisted truth arrives', () => {
        const { rerender, onCommit, onCancel } = renderHandle();
        const handle = screen.getByRole('separator');

        fireEvent.pointerDown(handle, { button: 0, pointerId: 9, isPrimary: true, clientY: 100 });
        fireEvent.pointerMove(handle, { pointerId: 9, clientY: 50 });

        rerender(
            <TimelineMinimapResizeHandle
                height={92}
                persistedHeight={92}
                onPreview={vi.fn()}
                onCommit={onCommit}
                onCancel={onCancel}
            />
        );
        fireEvent.pointerUp(handle, { pointerId: 9, clientY: 50 });

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('ignores secondary and non-primary pointers', () => {
        const { onPreview, onCommit } = renderHandle();
        const handle = screen.getByRole('separator');

        fireEvent.pointerDown(handle, { button: 2, pointerId: 1, isPrimary: true, clientY: 40 });
        fireEvent.pointerDown(handle, { button: 0, pointerId: 2, isPrimary: false, clientY: 40 });
        fireEvent.pointerMove(handle, { pointerId: 2, clientY: 20 });
        fireEvent.pointerUp(handle, { pointerId: 2, clientY: 20 });

        expect(setPointerCapture).not.toHaveBeenCalled();
        expect(onPreview).not.toHaveBeenCalled();
        expect(onCommit).not.toHaveBeenCalled();
    });
});

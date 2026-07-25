import { render, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ResizeHandle } from '../ResizeHandle';

describe('ResizeHandle', () => {
    beforeEach(() => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    describe('vertical direction', () => {
        it('calls onResize with the clientX delta during a drag', () => {
            const onResize = vi.fn();
            const { container } = render(<ResizeHandle direction="vertical" onResize={onResize} />);
            const handle = container.firstChild as HTMLElement;
            fireEvent.mouseDown(handle, { clientX: 100, clientY: 50 });
            fireEvent.mouseMove(document, { clientX: 130, clientY: 99 });
            // delta = 130 - 100 = 30 (vertical uses clientX).
            expect(onResize).toHaveBeenCalledWith(30);
        });

        it('sets the col-resize cursor and disables user-select on mousedown', () => {
            const onResize = vi.fn();
            const { container } = render(<ResizeHandle direction="vertical" onResize={onResize} />);
            fireEvent.mouseDown(container.firstChild as HTMLElement, { clientX: 0, clientY: 0 });
            expect(document.body.style.cursor).toBe('col-resize');
            expect(document.body.style.userSelect).toBe('none');
        });

        it('renders with vertical aria-orientation and col-resize cursor class', () => {
            const { container } = render(<ResizeHandle direction="vertical" onResize={vi.fn()} />);
            const handle = container.firstChild as HTMLElement;
            expect(handle).toHaveAttribute('role', 'separator');
            expect(handle).toHaveAttribute('aria-orientation', 'vertical');
            expect(handle.className).toContain('cursor-col-resize');
        });
    });

    describe('horizontal direction', () => {
        it('calls onResize with the clientY delta during a drag', () => {
            const onResize = vi.fn();
            const { container } = render(<ResizeHandle direction="horizontal" onResize={onResize} />);
            const handle = container.firstChild as HTMLElement;
            fireEvent.mouseDown(handle, { clientX: 0, clientY: 200 });
            fireEvent.mouseMove(document, { clientX: 50, clientY: 230 });
            // delta = 230 - 200 = 30 (horizontal uses clientY).
            expect(onResize).toHaveBeenCalledWith(30);
        });

        it('sets the row-resize cursor on mousedown', () => {
            const onResize = vi.fn();
            const { container } = render(<ResizeHandle direction="horizontal" onResize={onResize} />);
            fireEvent.mouseDown(container.firstChild as HTMLElement, { clientX: 0, clientY: 0 });
            expect(document.body.style.cursor).toBe('row-resize');
        });

        it('renders with horizontal aria-orientation and row-resize cursor class', () => {
            const { container } = render(<ResizeHandle direction="horizontal" onResize={vi.fn()} />);
            const handle = container.firstChild as HTMLElement;
            expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
            expect(handle.className).toContain('cursor-row-resize');
        });
    });

    describe('drag lifecycle', () => {
        it('accumulates deltas across multiple mouse moves', () => {
            const onResize = vi.fn();
            const { container } = render(<ResizeHandle direction="vertical" onResize={onResize} />);
            fireEvent.mouseDown(container.firstChild as HTMLElement, { clientX: 0, clientY: 0 });
            fireEvent.mouseMove(document, { clientX: 10, clientY: 0 });
            fireEvent.mouseMove(document, { clientX: 25, clientY: 0 });
            // First move: 10 - 0 = 10. Second move: 25 - 10 = 15.
            expect(onResize).toHaveBeenNthCalledWith(1, 10);
            expect(onResize).toHaveBeenNthCalledWith(2, 15);
        });

        it('calls onResizeEnd and restores cursor/userSelect on mouseup', () => {
            const onResize = vi.fn();
            const onResizeEnd = vi.fn();
            const { container } = render(
                <ResizeHandle direction="vertical" onResize={onResize} onResizeEnd={onResizeEnd} />
            );
            fireEvent.mouseDown(container.firstChild as HTMLElement, { clientX: 0, clientY: 0 });
            fireEvent.mouseMove(document, { clientX: 10, clientY: 0 });
            fireEvent.mouseUp(document);
            expect(onResizeEnd).toHaveBeenCalledTimes(1);
            expect(document.body.style.cursor).toBe('');
            expect(document.body.style.userSelect).toBe('');
        });

        it('does not call onResize when the mouse moves without an active drag', () => {
            const onResize = vi.fn();
            render(<ResizeHandle direction="vertical" onResize={onResize} />);
            fireEvent.mouseMove(document, { clientX: 500, clientY: 0 });
            expect(onResize).not.toHaveBeenCalled();
        });

        it('does not call onResizeEnd on mouseup when no drag was active', () => {
            const onResizeEnd = vi.fn();
            render(<ResizeHandle direction="vertical" onResize={vi.fn()} onResizeEnd={onResizeEnd} />);
            fireEvent.mouseUp(document);
            expect(onResizeEnd).not.toHaveBeenCalled();
        });

        it('does not call onResizeEnd when onResizeEnd is not provided', () => {
            const onResize = vi.fn();
            const { container } = render(<ResizeHandle direction="vertical" onResize={onResize} />);
            fireEvent.mouseDown(container.firstChild as HTMLElement, { clientX: 0, clientY: 0 });
            // Should not throw when onResizeEnd is undefined.
            expect(() => fireEvent.mouseUp(document)).not.toThrow();
        });
    });

    describe('cleanup on unmount', () => {
        it('stops responding to mouse moves after unmount', () => {
            const onResize = vi.fn();
            const { container, unmount } = render(<ResizeHandle direction="vertical" onResize={onResize} />);
            fireEvent.mouseDown(container.firstChild as HTMLElement, { clientX: 0, clientY: 0 });
            unmount();
            // After unmount, document listeners are removed — no onResize calls.
            fireEvent.mouseMove(document, { clientX: 999, clientY: 0 });
            // Only the pre-unmount state; the post-unmount move must not fire.
            const callsAfterUnmount = onResize.mock.calls.length;
            fireEvent.mouseMove(document, { clientX: 1000, clientY: 0 });
            expect(onResize.mock.calls.length).toBe(callsAfterUnmount);
            cleanup();
        });
    });
});

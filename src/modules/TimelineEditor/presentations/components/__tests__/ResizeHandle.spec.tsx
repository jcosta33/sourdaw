import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ResizeHandle } from '../ResizeHandle';

describe('ResizeHandle — separator structure', () => {
    it('renders a separator role', () => {
        render(<ResizeHandle direction="vertical" onResize={vi.fn()} />);
        expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('aria-orientation is vertical for vertical direction', () => {
        render(<ResizeHandle direction="vertical" onResize={vi.fn()} />);
        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
    });

    it('aria-orientation is horizontal for horizontal direction', () => {
        render(<ResizeHandle direction="horizontal" onResize={vi.fn()} />);
        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
    });
});

describe('ResizeHandle — mouse drag interaction', () => {
    beforeEach(() => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    it('calls onResize with the delta when dragging vertically', () => {
        const onResize = vi.fn();
        render(<ResizeHandle direction="vertical" onResize={onResize} />);

        // Start drag at clientX=100
        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100, preventDefault: vi.fn() });
        // Move to clientX=150 → delta = 50
        fireEvent.mouseMove(document, { clientX: 150 });

        expect(onResize).toHaveBeenCalledWith(50);
    });

    it('calls onResize with the delta when dragging horizontally', () => {
        const onResize = vi.fn();
        render(<ResizeHandle direction="horizontal" onResize={onResize} />);

        fireEvent.mouseDown(screen.getByRole('separator'), { clientY: 200, preventDefault: vi.fn() });
        fireEvent.mouseMove(document, { clientY: 180 });

        expect(onResize).toHaveBeenCalledWith(-20);
    });

    it('does not call onResize before mouseDown', () => {
        const onResize = vi.fn();
        render(<ResizeHandle direction="vertical" onResize={onResize} />);
        fireEvent.mouseMove(document, { clientX: 100 });
        expect(onResize).not.toHaveBeenCalled();
    });

    it('calls onResizeEnd when drag ends (mouseup)', () => {
        const onResizeEnd = vi.fn();
        render(<ResizeHandle direction="vertical" onResize={vi.fn()} onResizeEnd={onResizeEnd} />);

        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 0, preventDefault: vi.fn() });
        fireEvent.mouseUp(document);

        expect(onResizeEnd).toHaveBeenCalledTimes(1);
    });

    it('sets body cursor during drag and clears it on release', () => {
        render(<ResizeHandle direction="vertical" onResize={vi.fn()} />);

        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 0, preventDefault: vi.fn() });
        expect(document.body.style.cursor).toBe('col-resize');
        expect(document.body.style.userSelect).toBe('none');

        fireEvent.mouseUp(document);
        expect(document.body.style.cursor).toBe('');
        expect(document.body.style.userSelect).toBe('');
    });

    it('uses row-resize cursor for horizontal direction', () => {
        render(<ResizeHandle direction="horizontal" onResize={vi.fn()} />);
        fireEvent.mouseDown(screen.getByRole('separator'), { clientY: 0, preventDefault: vi.fn() });
        expect(document.body.style.cursor).toBe('row-resize');
    });

    it('stops calling onResize after mouseUp', () => {
        const onResize = vi.fn();
        render(<ResizeHandle direction="vertical" onResize={onResize} />);

        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 0, preventDefault: vi.fn() });
        fireEvent.mouseMove(document, { clientX: 10 });
        fireEvent.mouseUp(document);
        fireEvent.mouseMove(document, { clientX: 20 });

        // Only the pre-mouseUp move should have fired.
        expect(onResize).toHaveBeenCalledTimes(1);
    });

    // Ported from the byte-identical dead copy that used to sit in
    // WorkspaceShell/presentations/components before it was deleted.
    it('reports each move relative to the previous one, not to the drag origin', () => {
        const onResize = vi.fn();
        render(<ResizeHandle direction="vertical" onResize={onResize} />);

        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 0, preventDefault: vi.fn() });
        fireEvent.mouseMove(document, { clientX: 10 });
        fireEvent.mouseMove(document, { clientX: 25 });

        expect(onResize).toHaveBeenNthCalledWith(1, 10);
        expect(onResize).toHaveBeenNthCalledWith(2, 15);
    });

    it('does not call onResizeEnd on a mouseup that ends no drag', () => {
        const onResizeEnd = vi.fn();
        render(<ResizeHandle direction="vertical" onResize={vi.fn()} onResizeEnd={onResizeEnd} />);

        fireEvent.mouseUp(document);

        expect(onResizeEnd).not.toHaveBeenCalled();
    });

    it('ends a drag without throwing when onResizeEnd is omitted', () => {
        render(<ResizeHandle direction="vertical" onResize={vi.fn()} />);

        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 0, preventDefault: vi.fn() });

        expect(() => fireEvent.mouseUp(document)).not.toThrow();
    });

    it('detaches its document listeners on unmount mid-drag', () => {
        const onResize = vi.fn();
        const { unmount } = render(<ResizeHandle direction="vertical" onResize={onResize} />);

        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 0, preventDefault: vi.fn() });
        unmount();
        fireEvent.mouseMove(document, { clientX: 999 });

        expect(onResize).not.toHaveBeenCalled();
    });

    it('clears the body cursor and user-select on unmount mid-drag instead of stranding them', () => {
        const { unmount } = render(<ResizeHandle direction="vertical" onResize={vi.fn()} />);

        fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 0, preventDefault: vi.fn() });
        expect(document.body.style.cursor).toBe('col-resize');
        expect(document.body.style.userSelect).toBe('none');

        unmount();

        expect(document.body.style.cursor).toBe('');
        expect(document.body.style.userSelect).toBe('');
    });

    it('does not clear the cursor on unmount when no drag was in progress', () => {
        document.body.style.cursor = 'wait';
        const { unmount } = render(<ResizeHandle direction="vertical" onResize={vi.fn()} />);

        unmount();

        expect(document.body.style.cursor).toBe('wait');
        document.body.style.cursor = '';
    });
});

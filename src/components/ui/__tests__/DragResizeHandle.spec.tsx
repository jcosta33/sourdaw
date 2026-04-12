import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DragResizeHandle } from '../DragResizeHandle';

describe('DragResizeHandle', () => {
    it('should call onResize with signed delta for right side', () => {
        const onResize = vi.fn();
        const { container } = render(<DragResizeHandle side="right" onResize={onResize} />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { clientX: 100, clientY: 0 });
        fireEvent.mouseMove(document, { clientX: 110, clientY: 0 });
        fireEvent.mouseUp(document);
        expect(onResize).toHaveBeenCalledWith(10);
    });

    it('should invert delta for left side', () => {
        const onResize = vi.fn();
        const { container } = render(<DragResizeHandle side="left" onResize={onResize} />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { clientX: 100, clientY: 0 });
        fireEvent.mouseMove(document, { clientX: 110, clientY: 0 });
        fireEvent.mouseUp(document);
        expect(onResize).toHaveBeenCalledWith(-10);
    });

    it('should use vertical axis for top side', () => {
        const onResize = vi.fn();
        const { container } = render(<DragResizeHandle side="top" onResize={onResize} />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { clientX: 0, clientY: 100 });
        fireEvent.mouseMove(document, { clientX: 0, clientY: 90 });
        fireEvent.mouseUp(document);
        expect(onResize).toHaveBeenCalled();
    });

    it('should use vertical axis for bottom side', () => {
        const onResize = vi.fn();
        const { container } = render(<DragResizeHandle side="bottom" onResize={onResize} />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { clientX: 0, clientY: 100 });
        fireEvent.mouseMove(document, { clientX: 0, clientY: 110 });
        fireEvent.mouseUp(document);
        expect(onResize).toHaveBeenCalled();
    });
});

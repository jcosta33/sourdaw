import { render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DragResizeHandle } from '../DragResizeHandle';

describe('DragResizeHandle', () => {
    beforeEach(() => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

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

    it('should call onResizeEnd on mouse up', () => {
        const onResizeEnd = vi.fn();
        const { container } = render(<DragResizeHandle side="right" onResize={vi.fn()} onResizeEnd={onResizeEnd} />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { clientX: 100, clientY: 0 });
        fireEvent.mouseMove(document, { clientX: 110, clientY: 0 });
        expect(onResizeEnd).not.toHaveBeenCalled();
        fireEvent.mouseUp(document);
        expect(onResizeEnd).toHaveBeenCalledTimes(1);
    });

    it('should not call onResizeEnd on mouse up if no drag was active', () => {
        const onResizeEnd = vi.fn();
        render(<DragResizeHandle side="right" onResize={vi.fn()} onResizeEnd={onResizeEnd} />);
        fireEvent.mouseUp(document);
        expect(onResizeEnd).not.toHaveBeenCalled();
    });

    it('forwards ref to the separator element', () => {
        const ref = { current: null as HTMLDivElement | null };
        render(<DragResizeHandle ref={ref} onResize={vi.fn()} />);
        expect(ref.current).toBe(screen.getByRole('separator'));
    });

    describe('direction props', () => {
        it('supports direction="vertical" with horizontal drag', () => {
            const onResize = vi.fn();
            render(<DragResizeHandle direction="vertical" onResize={onResize} />);
            const separator = screen.getByRole('separator');
            expect(separator).toHaveAttribute('aria-orientation', 'vertical');

            fireEvent.mouseDown(separator, { clientX: 50, clientY: 0 });
            fireEvent.mouseMove(document, { clientX: 75, clientY: 0 });
            fireEvent.mouseUp(document);

            expect(onResize).toHaveBeenCalledWith(25);
        });

        it('supports direction="horizontal" with vertical drag', () => {
            const onResize = vi.fn();
            render(<DragResizeHandle direction="horizontal" onResize={onResize} />);
            const separator = screen.getByRole('separator');
            expect(separator).toHaveAttribute('aria-orientation', 'horizontal');

            fireEvent.mouseDown(separator, { clientX: 0, clientY: 100 });
            fireEvent.mouseMove(document, { clientX: 0, clientY: 130 });
            fireEvent.mouseUp(document);

            expect(onResize).toHaveBeenCalledWith(30);
        });
    });

    describe('keyboard navigation', () => {
        it('supports ArrowRight and ArrowLeft for vertical handles', () => {
            const onResize = vi.fn();
            const onResizeEnd = vi.fn();
            render(<DragResizeHandle direction="vertical" onResize={onResize} onResizeEnd={onResizeEnd} />);
            const separator = screen.getByRole('separator');

            fireEvent.keyDown(separator, { key: 'ArrowRight' });
            expect(onResize).toHaveBeenLastCalledWith(10);
            expect(onResizeEnd).toHaveBeenCalledTimes(1);

            fireEvent.keyDown(separator, { key: 'ArrowLeft' });
            expect(onResize).toHaveBeenLastCalledWith(-10);
            expect(onResizeEnd).toHaveBeenCalledTimes(2);
        });

        it('supports ArrowDown and ArrowUp for horizontal handles', () => {
            const onResize = vi.fn();
            const onResizeEnd = vi.fn();
            render(<DragResizeHandle direction="horizontal" onResize={onResize} onResizeEnd={onResizeEnd} />);
            const separator = screen.getByRole('separator');

            fireEvent.keyDown(separator, { key: 'ArrowDown' });
            expect(onResize).toHaveBeenLastCalledWith(10);
            expect(onResizeEnd).toHaveBeenCalledTimes(1);

            fireEvent.keyDown(separator, { key: 'ArrowUp' });
            expect(onResize).toHaveBeenLastCalledWith(-10);
            expect(onResizeEnd).toHaveBeenCalledTimes(2);
        });

        it('inverts keyboard delta for left and top sides', () => {
            const onResizeLeft = vi.fn();
            const { unmount } = render(<DragResizeHandle side="left" onResize={onResizeLeft} />);
            const leftSeparator = screen.getByRole('separator');

            fireEvent.keyDown(leftSeparator, { key: 'ArrowRight' });
            expect(onResizeLeft).toHaveBeenLastCalledWith(-10);

            fireEvent.keyDown(leftSeparator, { key: 'ArrowLeft' });
            expect(onResizeLeft).toHaveBeenLastCalledWith(10);

            unmount();

            const onResizeTop = vi.fn();
            render(<DragResizeHandle side="top" onResize={onResizeTop} />);
            const topSeparator = screen.getByRole('separator');

            fireEvent.keyDown(topSeparator, { key: 'ArrowDown' });
            expect(onResizeTop).toHaveBeenLastCalledWith(-10);

            fireEvent.keyDown(topSeparator, { key: 'ArrowUp' });
            expect(onResizeTop).toHaveBeenLastCalledWith(10);
        });

        it('respects custom step prop', () => {
            const onResize = vi.fn();
            render(<DragResizeHandle direction="vertical" step={4} onResize={onResize} />);
            const separator = screen.getByRole('separator');

            fireEvent.keyDown(separator, { key: 'ArrowRight' });
            expect(onResize).toHaveBeenCalledWith(4);
        });

        it('handles Home and End keys when bounds and current value are defined', () => {
            const onResize = vi.fn();
            const onResizeEnd = vi.fn();
            render(
                <DragResizeHandle
                    direction="vertical"
                    aria-valuenow={60}
                    aria-valuemin={20}
                    aria-valuemax={100}
                    onResize={onResize}
                    onResizeEnd={onResizeEnd}
                />
            );
            const separator = screen.getByRole('separator');

            fireEvent.keyDown(separator, { key: 'Home' });
            expect(onResize).toHaveBeenLastCalledWith(-40);
            expect(onResizeEnd).toHaveBeenCalledTimes(1);

            fireEvent.keyDown(separator, { key: 'End' });
            expect(onResize).toHaveBeenLastCalledWith(40);
            expect(onResizeEnd).toHaveBeenCalledTimes(2);
        });
    });

    describe('unmount mid-drag cleanup', () => {
        it('detaches document listeners on unmount mid-drag', () => {
            const removeSpy = vi.spyOn(document, 'removeEventListener');
            try {
                const onResize = vi.fn();
                const { unmount } = render(<DragResizeHandle side="right" onResize={onResize} />);
                const separator = screen.getByRole('separator');

                fireEvent.mouseDown(separator, { clientX: 100, clientY: 0 });
                unmount();

                expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
                expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
                expect(removeSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
                expect(removeSpy).toHaveBeenCalledWith('pointerup', expect.any(Function));
                expect(removeSpy).toHaveBeenCalledWith('pointercancel', expect.any(Function));

                fireEvent.mouseMove(document, { clientX: 150, clientY: 0 });
                expect(onResize).not.toHaveBeenCalled();
            } finally {
                removeSpy.mockRestore();
            }
        });

        it('clears body cursor and user-select on unmount mid-drag', () => {
            const { unmount } = render(<DragResizeHandle side="right" onResize={vi.fn()} />);
            const separator = screen.getByRole('separator');

            fireEvent.mouseDown(separator, { clientX: 100, clientY: 0 });
            expect(document.body.style.cursor).toBe('col-resize');
            expect(document.body.style.userSelect).toBe('none');

            unmount();
            expect(document.body.style.cursor).toBe('');
            expect(document.body.style.userSelect).toBe('');
        });

        it('does not clear body cursor on unmount when no drag was active', () => {
            document.body.style.cursor = 'wait';
            const { unmount } = render(<DragResizeHandle side="right" onResize={vi.fn()} />);

            unmount();
            expect(document.body.style.cursor).toBe('wait');
            document.body.style.cursor = '';
        });
    });

    describe('pointer events and capture', () => {
        it('captures and releases pointer on pointer drag', () => {
            const onResize = vi.fn();
            const onResizeEnd = vi.fn();
            const { container } = render(
                <DragResizeHandle side="right" onResize={onResize} onResizeEnd={onResizeEnd} />
            );
            const handle = container.firstChild as HTMLElement;
            const setPointerCapture = vi.fn();
            const releasePointerCapture = vi.fn();
            handle.setPointerCapture = setPointerCapture;
            handle.releasePointerCapture = releasePointerCapture;

            fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 100, clientY: 0 });
            expect(setPointerCapture).toHaveBeenCalledWith(7);

            fireEvent.pointerMove(document, { pointerId: 7, clientX: 120, clientY: 0 });
            expect(onResize).toHaveBeenCalledWith(20);

            fireEvent.pointerUp(document);
            expect(releasePointerCapture).toHaveBeenCalledWith(7);
            expect(onResizeEnd).toHaveBeenCalledTimes(1);
        });
    });
});

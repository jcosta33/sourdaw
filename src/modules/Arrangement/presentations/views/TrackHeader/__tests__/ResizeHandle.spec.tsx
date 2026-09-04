import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackHeight } from '../../../../useCases/toggleTrackState/setTrackHeight';
import { ResizeHandle } from '../ResizeHandle';

// Mock external dependencies
vi.mock('../../../../useCases/toggleTrackState/setTrackHeight', () => ({
    setTrackHeight: vi.fn(),
}));

describe('ResizeHandle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should have correct role', () => {
        render(<ResizeHandle trackId="track1" />);
        expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('should have correct aria attributes', () => {
        render(<ResizeHandle trackId="track1" />);
        const separator = screen.getByRole('separator');
        expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
        expect(separator).toHaveAttribute('aria-label', 'Resize track height');
    });

    it('should have resize cursor', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('cursor-ns-resize');
    });

    it('should handle mouse down', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        expect(handle).toBeInTheDocument();
    });

    it('should set body cursor during resize', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        expect(document.body.style.cursor).toBe('ns-resize');
    });

    it('should have hover opacity', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('opacity-0');
        expect(container.firstChild).toHaveClass('hover:opacity-100');
    });

    it('should have transition', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('transition-opacity');
    });

    it('should have correct positioning', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('absolute');
        expect(container.firstChild).toHaveClass('bottom-0');
        expect(container.firstChild).toHaveClass('left-0');
        expect(container.firstChild).toHaveClass('right-0');
    });

    it('should have correct height', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('h-1');
    });

    it('should have focus-visible styles', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('focus-visible:opacity-100');
        expect(container.firstChild).toHaveClass('focus-visible:bg-ring/40');
    });

    it('stops event propagation on mouseDown and pointerDown', () => {
        render(<ResizeHandle trackId="track1" />);
        const handle = screen.getByRole('separator');

        const mouseDownEvent = createEvent.mouseDown(handle);
        const stopMouseDownSpy = vi.spyOn(mouseDownEvent, 'stopPropagation');
        fireEvent(handle, mouseDownEvent);
        expect(stopMouseDownSpy).toHaveBeenCalled();

        const pointerDownEvent = createEvent.pointerDown(handle);
        const stopPointerDownSpy = vi.spyOn(pointerDownEvent, 'stopPropagation');
        fireEvent(handle, pointerDownEvent);
        expect(stopPointerDownSpy).toHaveBeenCalled();
    });

    it('invokes setTrackHeight with expected height on mouse drag', () => {
        const { container } = render(
            <div style={{ height: '80px' }}>
                <ResizeHandle trackId="track1" />
            </div>
        );
        const parent = container.firstChild as HTMLElement;
        vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
            height: 80,
        } as DOMRect);

        const handle = screen.getByRole('separator');
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 120 });
        fireEvent.mouseUp(document);

        expect(setTrackHeight).toHaveBeenCalledWith('track1', 100);
    });

    it('invokes setTrackHeight on keyboard ArrowDown and ArrowUp', () => {
        const { container } = render(
            <div style={{ height: '80px' }}>
                <ResizeHandle trackId="track1" />
            </div>
        );
        const parent = container.firstChild as HTMLElement;
        vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
            height: 80,
        } as DOMRect);

        const handle = screen.getByRole('separator');

        fireEvent.keyDown(handle, { key: 'ArrowDown' });
        expect(setTrackHeight).toHaveBeenLastCalledWith('track1', 90);

        fireEvent.keyDown(handle, { key: 'ArrowUp' });
        expect(setTrackHeight).toHaveBeenLastCalledWith('track1', 70);
    });

    it('clamps track height within bounds and prevents reversing deadzones', () => {
        const { container } = render(
            <div style={{ height: '290px' }}>
                <ResizeHandle trackId="track1" />
            </div>
        );
        const parent = container.firstChild as HTMLElement;
        vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
            height: 290,
        } as DOMRect);

        const handle = screen.getByRole('separator');
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });

        // Drag down by 50px (290 + 50 = 340 -> clamped to 300)
        fireEvent.mouseMove(document, { clientY: 150 });
        expect(setTrackHeight).toHaveBeenLastCalledWith('track1', 300);

        // Reverse drag up by 10px (should immediately decrease from 300 to 290, no deadzone)
        fireEvent.mouseMove(document, { clientY: 140 });
        expect(setTrackHeight).toHaveBeenLastCalledWith('track1', 290);

        fireEvent.mouseUp(document);
    });
});

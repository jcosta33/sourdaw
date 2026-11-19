import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeUserAppAction } from '#/modules/Command/useCases';

import { timelineViewStore } from '../../../../stores/timelineViewStore';
import { ResizeHandle } from '../ResizeHandle';

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeUserAppAction: vi.fn(),
}));

const defaultProps = { trackId: 'track1', trackName: 'Test Track', height: 80, displayHeight: 80, heightScale: 1 };

describe('ResizeHandle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should have correct role', () => {
        render(<ResizeHandle {...defaultProps} />);
        expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('should have correct aria attributes', () => {
        render(<ResizeHandle {...defaultProps} />);
        const separator = screen.getByRole('separator');
        expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
        expect(separator).toHaveAttribute('aria-label', 'Resize Test Track height');
    });

    it('exposes the displayed track height and bounds in CSS pixels', () => {
        render(<ResizeHandle {...defaultProps} height={81} displayHeight={50.625} heightScale={0.625} />);
        const separator = screen.getByRole('separator', { name: 'Resize Test Track height' });
        expect(separator).toHaveAttribute('aria-valuenow', '50.625');
        expect(separator).toHaveAttribute('aria-valuemin', '18.75');
        expect(separator).toHaveAttribute('aria-valuemax', '187.5');
    });

    it('should have resize cursor', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        expect(container.firstChild).toHaveClass('cursor-ns-resize');
    });

    it('should handle mouse down', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        expect(handle).toBeInTheDocument();
    });

    it('should set body cursor during resize', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        expect(document.body.style.cursor).toBe('ns-resize');
    });

    it('should have hover opacity', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        expect(container.firstChild).toHaveClass('opacity-0');
        expect(container.firstChild).toHaveClass('hover:opacity-100');
    });

    it('should have transition', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        expect(container.firstChild).toHaveClass('transition-opacity');
    });

    it('should have correct positioning', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        expect(container.firstChild).toHaveClass('absolute');
        expect(container.firstChild).toHaveClass('bottom-0');
        expect(container.firstChild).toHaveClass('left-0');
        expect(container.firstChild).toHaveClass('right-0');
    });

    it('should have correct height', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        expect(container.firstChild).toHaveClass('h-1');
    });

    it('should have focus-visible styles', () => {
        const { container } = render(<ResizeHandle {...defaultProps} />);
        expect(container.firstChild).toHaveClass('focus-visible:opacity-100');
        expect(container.firstChild).toHaveClass('focus-visible:bg-ring/40');
    });

    it('stops event propagation on mouseDown and pointerDown', () => {
        render(<ResizeHandle {...defaultProps} />);
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

    it('previews incremental display deltas during drag and dispatches one unscaled action on release', () => {
        render(<ResizeHandle {...defaultProps} displayHeight={120} heightScale={1.5} />);
        const handle = screen.getByRole('separator');
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 107 });
        fireEvent.mouseMove(document, { clientY: 112 });

        expect(timelineViewStore.value?.trackHeightPreview).toEqual({ trackId: 'track1', height: 88 });
        expect(executeUserAppAction).not.toHaveBeenCalled();

        fireEvent.mouseUp(document);

        expect(timelineViewStore.value?.trackHeightPreview).toBeNull();
        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'setTrackHeight',
            payload: { trackId: 'track1', height: 88 },
        });
    });

    it('turns keyboard arrows and Home/End into unscaled action heights', () => {
        render(<ResizeHandle {...defaultProps} displayHeight={50} heightScale={0.625} />);
        const handle = screen.getByRole('separator');
        fireEvent.keyDown(handle, { key: 'ArrowDown' });
        fireEvent.keyDown(handle, { key: 'ArrowUp' });
        fireEvent.keyDown(handle, { key: 'Home' });
        fireEvent.keyDown(handle, { key: 'End' });

        expect(vi.mocked(executeUserAppAction).mock.calls.map(([action]) => action)).toEqual(
            [96, 64, 30, 300].map((height) => ({ type: 'setTrackHeight', payload: { trackId: 'track1', height } }))
        );
    });

    it('clamps track height within bounds and prevents reversing deadzones', () => {
        render(<ResizeHandle {...defaultProps} height={290} displayHeight={435} heightScale={1.5} />);
        const handle = screen.getByRole('separator');
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });

        fireEvent.mouseMove(document, { clientY: 160 });
        expect(timelineViewStore.value?.trackHeightPreview?.height).toBe(300);
        fireEvent.mouseMove(document, { clientY: 130 });
        expect(timelineViewStore.value?.trackHeightPreview?.height).toBe(280);

        fireEvent.mouseUp(document);
        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'setTrackHeight',
            payload: { trackId: 'track1', height: 280 },
        });
    });

    it.each([
        ['Home', (handle: HTMLElement) => fireEvent.keyDown(handle, { key: 'Home' })],
        ['End', (handle: HTMLElement) => fireEvent.keyDown(handle, { key: 'End' })],
        ['an arrow key', (handle: HTMLElement) => fireEvent.keyDown(handle, { key: 'ArrowDown' })],
        ['another pointer moving', () => fireEvent.pointerMove(document, { pointerId: 2, clientY: 180 })],
        ['another pointer releasing', () => fireEvent.pointerUp(document, { pointerId: 2 })],
        ['another pointer canceling', () => fireEvent.pointerCancel(document, { pointerId: 2 })],
        ['a compatibility mouse move', () => fireEvent.mouseMove(document, { clientY: 180 })],
        ['a compatibility mouse up', () => fireEvent.mouseUp(document)],
    ] as const)('keeps the initiating pointer in control despite %s', (_label, interrupt) => {
        render(<ResizeHandle {...defaultProps} />);
        const handle = screen.getByRole('separator');
        handle.focus();
        expect(handle).toHaveFocus();
        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(document, { pointerId: 1, clientY: 120 });
        expect(timelineViewStore.value?.trackHeightPreview?.height).toBe(100);

        interrupt(handle);

        expect(executeUserAppAction).not.toHaveBeenCalled();
        expect(timelineViewStore.value?.trackHeightPreview?.height).toBe(100);

        fireEvent.pointerMove(document, { pointerId: 1, clientY: 130 });
        fireEvent.pointerUp(document, { pointerId: 1 });

        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'setTrackHeight',
            payload: { trackId: 'track1', height: 110 },
        });
        expect(timelineViewStore.value?.trackHeightPreview).toBeNull();
    });

    it('discards a canceled pointer resize and allows the next drag to commit', () => {
        render(<ResizeHandle {...defaultProps} />);
        const handle = screen.getByRole('separator');
        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(document, { pointerId: 1, clientY: 120 });
        expect(timelineViewStore.value?.trackHeightPreview?.height).toBe(100);

        fireEvent.pointerCancel(handle, { pointerId: 1 });

        expect(timelineViewStore.value?.trackHeightPreview).toBeNull();
        expect(executeUserAppAction).not.toHaveBeenCalled();
        fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(document, { pointerId: 2, clientY: 110 });
        fireEvent.pointerUp(document, { pointerId: 2 });
        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'setTrackHeight',
            payload: { trackId: 'track1', height: 90 },
        });
    });

    it('clears a pending resize when unmounted without dispatching', () => {
        const { unmount } = render(<ResizeHandle {...defaultProps} />);
        const handle = screen.getByRole('separator');
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 120 });
        expect(timelineViewStore.value?.trackHeightPreview?.height).toBe(100);

        unmount();
        fireEvent.mouseUp(document);

        expect(timelineViewStore.value?.trackHeightPreview).toBeNull();
        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('does not dispatch when an incremental drag returns to its starting height', () => {
        render(<ResizeHandle {...defaultProps} displayHeight={120} heightScale={1.5} />);
        const handle = screen.getByRole('separator');
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        fireEvent.mouseMove(document, { clientY: 101 });
        fireEvent.mouseMove(document, { clientY: 104 });
        fireEvent.mouseMove(document, { clientY: 100 });
        fireEvent.mouseUp(document);

        expect(executeUserAppAction).not.toHaveBeenCalled();
    });

    it('names each track height separator after its own track', () => {
        render(
            <>
                <ResizeHandle {...defaultProps} trackName="Kick" />
                <ResizeHandle {...defaultProps} trackId="track2" trackName="Snare" />
            </>
        );
        expect(screen.getByRole('separator', { name: 'Resize Kick height' })).toBeInTheDocument();
        expect(screen.getByRole('separator', { name: 'Resize Snare height' })).toBeInTheDocument();
        expect(screen.queryByRole('separator', { name: 'Resize track height' })).toBeNull();
    });
});

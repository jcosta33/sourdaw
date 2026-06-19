import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { setScrollX } from '../../../stores/timelineViewStore';
import { TimelineMinimap } from '../TimelineMinimap';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        value: { tracks: [], selectedTrackId: null },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        value: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
    setScrollY: vi.fn(),
    setScrollX: vi.fn(),
    setAutoScroll: vi.fn(),
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

// Track mock ResizeObserver
const observeMock = vi.fn();
const disconnectMock = vi.fn();
const unobserveMock = vi.fn();

class MockResizeObserver {
    observe = observeMock;
    disconnect = disconnectMock;
    unobserve = unobserveMock;
}

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TimelineMinimap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<TimelineMinimap />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render canvas element', () => {
        const { container } = renderWithTooltip(<TimelineMinimap />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should have correct accessibility attributes', () => {
        renderWithTooltip(<TimelineMinimap />);
        const slider = screen.getByRole('slider');
        expect(slider).toHaveAttribute(
            'aria-label',
            'Timeline minimap — drag the viewport to scroll, click to jump, or use arrow keys'
        );
        expect(slider).toHaveAttribute('aria-valuemin', '0');
        expect(slider).toHaveAttribute('aria-valuemax', '100');
    });

    it('is keyboard-focusable so screen-reader users can reach the slider', () => {
        renderWithTooltip(<TimelineMinimap />);
        expect(screen.getByRole('slider')).toHaveAttribute('tabindex', '0');
    });

    it('should have pointer cursor', () => {
        const { container } = renderWithTooltip(<TimelineMinimap />);
        expect(container.firstChild).toHaveClass('cursor-pointer');
    });

    it('should handle mouse down for viewport dragging', () => {
        const { container } = renderWithTooltip(<TimelineMinimap />);
        const minimap = container.firstChild as HTMLElement;
        fireEvent.mouseDown(minimap, { button: 0, clientX: 50 });
        expect(minimap).toBeInTheDocument();
    });

    it('should render with correct height', () => {
        const { container } = renderWithTooltip(<TimelineMinimap />);
        expect(container.firstChild).toHaveStyle({ height: '28px' });
    });

    it('should handle ResizeObserver', () => {
        renderWithTooltip(<TimelineMinimap />);
        expect(observeMock).toHaveBeenCalled();
    });

    it('scrolls the viewport right on ArrowRight and left on ArrowLeft (finding #94)', () => {
        renderWithTooltip(<TimelineMinimap />);
        const slider = screen.getByRole('slider');

        // scrollX=0, pixelsPerBeat=12, step=4 beats => 48px
        fireEvent.keyDown(slider, { key: 'ArrowRight' });
        expect(setScrollX).toHaveBeenLastCalledWith(48);

        fireEvent.keyDown(slider, { key: 'ArrowLeft' });
        expect(setScrollX).toHaveBeenLastCalledWith(-48);

        fireEvent.keyDown(slider, { key: 'Home' });
        expect(setScrollX).toHaveBeenLastCalledWith(0);
    });

    it('detaches global drag listeners when unmounted mid-drag (no leak)', () => {
        const { container, unmount } = renderWithTooltip(<TimelineMinimap />);
        const minimap = container.querySelector('[role="slider"]') as HTMLElement;

        const removeSpy = vi.spyOn(document, 'removeEventListener');
        // Begin a drag — this attaches document-level mousemove/mouseup listeners.
        fireEvent.mouseDown(minimap, { button: 0, clientX: 50 });

        // Unmount before mouseup fires.
        unmount();

        const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
        expect(removedEvents).toContain('mousemove');
        expect(removedEvents).toContain('mouseup');
        removeSpy.mockRestore();
    });
});

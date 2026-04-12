import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
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
        value: { scrollX: 0, pixelsPerBeat: 12 },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
    setScrollY: vi.fn(),
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
        global.ResizeObserver = MockResizeObserver as any;
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
        expect(slider).toHaveAttribute('aria-label', 'Timeline minimap — drag the viewport to scroll, click to jump');
        expect(slider).toHaveAttribute('aria-valuemin', '0');
        expect(slider).toHaveAttribute('aria-valuemax', '100');
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
});

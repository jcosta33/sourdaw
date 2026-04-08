import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimelineMinimap } from './TimelineMinimap';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: {},
}));

vi.mock('../../stores/timelineViewStore', () => ({
    timelineViewStore: { value: { scrollX: 0, pixelsPerBeat: 12 } },
    setScrollY: vi.fn(),
}));

vi.mock('./TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

let mockTrackState = { tracks: [], selectedTrackId: null };
let mockViewState = { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true };

vi.mocked(vi.importMock('#/infra/store/useStore').useStore).mockImplementation((store, defaultValue) => {
    if (store === vi.importMock('#/modules/Arrangement/stores/trackStore').trackStore) {
        return mockTrackState;
    }
    if (store === vi.importMock('../../stores/timelineViewStore').timelineViewStore) {
        return mockViewState;
    }
    return defaultValue;
});

describe('TimelineMinimap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTrackState = { tracks: [], selectedTrackId: null };
        mockViewState = { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true };
    });

    it('should render without crashing', () => {
        const { container } = render(<TimelineMinimap />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render canvas element', () => {
        const { container } = render(<TimelineMinimap />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should have correct accessibility attributes', () => {
        render(<TimelineMinimap />);
        const slider = screen.getByRole('slider');
        expect(slider).toHaveAttribute('aria-label', 'Timeline minimap — drag the viewport to scroll, click to jump');
        expect(slider).toHaveAttribute('aria-valuemin', '0');
        expect(slider).toHaveAttribute('aria-valuemax', '100');
    });

    it('should have pointer cursor', () => {
        const { container } = render(<TimelineMinimap />);
        expect(container.firstChild).toHaveClass('cursor-pointer');
    });

    it('should handle mouse down for viewport dragging', () => {
        const { container } = render(<TimelineMinimap />);
        const minimap = container.firstChild as HTMLElement;
        fireEvent.mouseDown(minimap, { button: 0, clientX: 50 });
        expect(minimap).toBeInTheDocument();
    });

    it('should render with correct height', () => {
        const { container } = render(<TimelineMinimap />);
        expect(container.firstChild).toHaveStyle({ height: '28px' });
    });

    it('should handle ResizeObserver', () => {
        const ResizeObserverMock = vi.fn(() => ({
            observe: vi.fn(),
            disconnect: vi.fn(),
        }));
        global.ResizeObserver = ResizeObserverMock;
        
        render(<TimelineMinimap />);
        expect(ResizeObserverMock).toHaveBeenCalled();
    });
});

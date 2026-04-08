import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkerLane } from './MarkerLane';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        markers: [],
        sections: [],
    })),
}));

vi.mock('../../stores/markerStore', () => ({
    markerStore: {},
}));

vi.mock('../../useCases/marker/markerOperations', () => ({
    addMarker: vi.fn(),
    removeMarker: vi.fn(),
    renameMarker: vi.fn(),
    setMarkerColor: vi.fn(),
    moveMarker: vi.fn(),
}));

vi.mock('#/helpers/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('./TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

let mockMarkerState = { markers: [], sections: [] };

vi.mocked(vi.importMock('#/infra/store/useStore').useStore).mockImplementation(() => mockMarkerState);

describe('MarkerLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMarkerState = { markers: [], sections: [] };
    });

    it('should render without crashing', () => {
        const { container } = render(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should have correct aria attributes', () => {
        render(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        const region = screen.getByRole('region');
        expect(region).toHaveAttribute('aria-label', 'Timeline markers');
    });

    it('should render markers when present', () => {
        mockMarkerState = {
            markers: [
                { id: 'm1', name: 'Intro', beat: 0, color: 'oklch(0.40 0.07 200)' },
                { id: 'm2', name: 'Chorus', beat: 16, color: 'oklch(0.40 0.08 150)' },
            ],
            sections: [],
        };
        render(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        expect(screen.getByText('Intro')).toBeInTheDocument();
        expect(screen.getByText('Chorus')).toBeInTheDocument();
    });

    it('should handle context menu on lane', () => {
        const { container } = render(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        const lane = container.querySelector('[role="region"]');
        fireEvent.contextMenu(lane!);
        expect(screen.getByText(/Add Marker at Beat/)).toBeInTheDocument();
    });

    it('should call addMarker when Add Marker is clicked', () => {
        const { addMarker } = vi.importMock('#/modules/Arrangement/useCases/marker/markerOperations');
        const { container } = render(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        const lane = container.querySelector('[role="region"]');
        fireEvent.contextMenu(lane!);
        const addButton = screen.getByText(/Add Marker at Beat/);
        fireEvent.click(addButton);
        expect(addMarker).toHaveBeenCalled();
    });

    it('should render marker context menu when marker is clicked', () => {
        mockMarkerState = {
            markers: [{ id: 'm1', name: 'Test Marker', beat: 8, color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };
        const { container } = render(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        const marker = screen.getByText('Test Marker');
        fireEvent.contextMenu(marker);
        expect(screen.getByText('Rename Marker')).toBeInTheDocument();
        expect(screen.getByText('Color')).toBeInTheDocument();
        expect(screen.getByText('Delete Marker')).toBeInTheDocument();
    });

    it('should have correct height style', () => {
        const { container } = render(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        expect(container.firstChild).toHaveStyle({ height: '20px' });
    });

    it('should have select-none class', () => {
        const { container } = render(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        expect(container.firstChild).toHaveClass('select-none');
    });
});

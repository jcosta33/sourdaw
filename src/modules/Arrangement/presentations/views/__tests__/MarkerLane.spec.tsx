import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { addMarker } from '../../../useCases/marker/markerOperations/addMarker';
import { MarkerLane } from '../MarkerLane';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => mockMarkerState),
}));

// Track mock state
let mockMarkerState = { markers: [] as any[], sections: [] };

vi.mock('../../../stores/markerStore', () => ({
    markerStore: {
        value: { markers: [], sections: [] },
        subscribe: vi.fn(() => vi.fn()),
        set: vi.fn(),
    },
}));

vi.mock('../../../useCases/marker/markerOperations/moveMarker', () => ({
    moveMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/setMarkerColor', () => ({
    setMarkerColor: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/renameMarker', () => ({
    renameMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/removeMarker', () => ({
    removeMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/addMarker', () => ({
    addMarker: vi.fn(),
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: vi.fn(({ children, onContextMenu, ...props }: any) => (
        <div {...props} onContextMenu={onContextMenu} data-testid="lane-surface">
            {children}
        </div>
    )),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('MarkerLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMarkerState = { markers: [], sections: [] };
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should have correct aria attributes', () => {
        renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
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
        renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        expect(screen.getByText('Intro')).toBeInTheDocument();
        expect(screen.getByText('Chorus')).toBeInTheDocument();
    });

    it('should handle context menu on lane', () => {
        renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        const lane = screen.getByTestId('lane-surface');

        // Mock rect
        lane.getBoundingClientRect = vi.fn(
            () =>
                ({
                    left: 0,
                    top: 0,
                    width: 1000,
                    height: 20,
                }) as any
        );

        fireEvent.contextMenu(lane, { clientX: 100, clientY: 10 });
        expect(screen.getByText(/Add Marker at Beat/)).toBeInTheDocument();
    });

    it('should call addMarker when Add Marker is clicked', () => {
        renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        const lane = screen.getByTestId('lane-surface');

        lane.getBoundingClientRect = vi.fn(
            () =>
                ({
                    left: 0,
                    top: 0,
                    width: 1000,
                    height: 20,
                }) as any
        );

        fireEvent.contextMenu(lane, { clientX: 100, clientY: 10 });
        const addButton = screen.getByText(/Add Marker at Beat/);
        fireEvent.click(addButton);
        expect(addMarker).toHaveBeenCalled();
    });

    it('should render marker context menu when right-clicking on a marker', async () => {
        mockMarkerState = {
            markers: [{ id: 'm1', name: 'Test Marker', beat: 10, color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };
        renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        const lane = screen.getByTestId('lane-surface');

        // Marker is at beat 10. pixelsPerBeat is 12.
        // Marker X should be 120.
        lane.getBoundingClientRect = vi.fn(
            () =>
                ({
                    left: 0,
                    top: 0,
                    width: 1000,
                    height: 20,
                }) as any
        );

        fireEvent.contextMenu(lane, {
            clientX: 120,
            clientY: 10,
            button: 2,
        });

        // Wait for the context menu to appear
        await waitFor(() => {
            expect(screen.getByText('Rename Marker')).toBeInTheDocument();
        });
        expect(screen.getByText('Color')).toBeInTheDocument();
        expect(screen.getByText('Delete Marker')).toBeInTheDocument();
    });

    it('should have correct height style', () => {
        const { container } = renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        expect(container.firstChild).toHaveStyle({ height: '20px' });
    });

    it('should have select-none class', () => {
        const { container } = renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);
        expect(container.firstChild).toHaveClass('select-none');
    });
});

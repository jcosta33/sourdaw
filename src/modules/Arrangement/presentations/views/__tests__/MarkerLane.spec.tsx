import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { addMarker } from '../../../useCases/marker/markerOperations/addMarker';
import { moveMarker } from '../../../useCases/marker/markerOperations/moveMarker';
import { removeMarker } from '../../../useCases/marker/markerOperations/removeMarker';
import { renameMarker } from '../../../useCases/marker/markerOperations/renameMarker';
import { setMarkerColor } from '../../../useCases/marker/markerOperations/setMarkerColor';
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

    it('detaches window drag listeners when unmounted mid-drag (no leak)', () => {
        mockMarkerState = {
            markers: [{ id: 'm1', name: 'Intro', beat: 4, color: 'oklch(0.40 0.07 200)' }],
            sections: [],
        };
        const { container, unmount } = renderWithTooltip(<MarkerLane pixelsPerBeat={12} scrollX={0} />);

        // The marker's drag handle carries the mousedown that attaches the
        // window-level mousemove/mouseup listeners.
        const dragHandle = container.querySelector('.cursor-ew-resize') as HTMLElement;
        expect(dragHandle).toBeTruthy();

        const removeSpy = vi.spyOn(window, 'removeEventListener');
        fireEvent.mouseDown(dragHandle, { button: 0, clientX: 48 });

        // Unmount before mouseup fires.
        unmount();

        const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
        expect(removedEvents).toContain('mousemove');
        expect(removedEvents).toContain('mouseup');
        removeSpy.mockRestore();
    });

    describe('MarkerLane — marker drag, rename, color, delete', () => {
        // Capture window mousemove/mouseup so a marker drag can be driven to commit.
        const captureWindowListeners = () => {
            const moves: Array<(e: { clientX: number }) => void> = [];
            const ups: Array<() => void> = [];
            const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((
                type: string,
                listener: (...args: never[]) => void
            ) => {
                if (type === 'mousemove') {
                    moves.push(listener as unknown as (e: { clientX: number }) => void);
                } else if (type === 'mouseup') {
                    ups.push(listener);
                }
            }) as typeof window.addEventListener);
            return {
                move: (clientX: number) => {
                    for (const m of moves) {
                        m({ clientX });
                    }
                },
                up: () => {
                    for (const u of ups) {
                        u();
                    }
                },
                restore: () => addSpy.mockRestore(),
            };
        };

        const openMarkerMenu = (lane: HTMLElement, markerX: number) => {
            lane.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 20 }) as never);
            fireEvent.contextMenu(lane, { clientX: markerX, clientY: 10 });
        };

        beforeEach(() => {
            mockMarkerState = {
                markers: [{ id: 'm1', name: 'Intro', beat: 10, color: 'oklch(0.40 0.07 200)' }],
                sections: [],
            };
        });

        it('moves the marker on drag-commit and does not commit when it did not move', () => {
            const listeners = captureWindowListeners();
            try {
                const { container } = renderWithTooltip(<MarkerLane pixelsPerBeat={10} scrollX={0} />);
                const dragHandle = container.querySelector('.cursor-ew-resize') as HTMLElement;
                // Marker at beat 10 → 100px. Drag from 100 to 150 (+50px = +5 beats).
                act(() => {
                    fireEvent.mouseDown(dragHandle, { button: 0, clientX: 100 });
                });
                act(() => {
                    listeners.move(150);
                });
                act(() => {
                    listeners.up();
                });
                expect(moveMarker).toHaveBeenCalledWith('m1', 15);
            } finally {
                listeners.restore();
            }
        });

        it('does not commit a move when the marker stays on its original beat', () => {
            const listeners = captureWindowListeners();
            try {
                const { container } = renderWithTooltip(<MarkerLane pixelsPerBeat={10} scrollX={0} />);
                const dragHandle = container.querySelector('.cursor-ew-resize') as HTMLElement;
                act(() => {
                    fireEvent.mouseDown(dragHandle, { button: 0, clientX: 100 });
                });
                act(() => {
                    listeners.move(102); // +0.2 beats → rounds back to beat 10
                });
                act(() => {
                    listeners.up();
                });
                expect(moveMarker).not.toHaveBeenCalled();
            } finally {
                listeners.restore();
            }
        });

        it('deletes the marker from the marker context menu', () => {
            renderWithTooltip(<MarkerLane pixelsPerBeat={10} scrollX={0} />);
            const lane = screen.getByTestId('lane-surface');
            openMarkerMenu(lane, 100);
            fireEvent.click(screen.getByText('Delete Marker'));
            expect(removeMarker).toHaveBeenCalledWith('m1');
        });

        it('sets the marker color from a swatch', () => {
            renderWithTooltip(<MarkerLane pixelsPerBeat={10} scrollX={0} />);
            const lane = screen.getByTestId('lane-surface');
            openMarkerMenu(lane, 100);
            const firstSwatch = screen
                .getAllByRole('button')
                .find((b) => b.getAttribute('aria-label')?.startsWith('Set color'));
            const firstColor = firstSwatch!.getAttribute('aria-label')!.replace('Set color ', '');
            fireEvent.click(firstSwatch!);
            expect(setMarkerColor).toHaveBeenCalledWith('m1', firstColor);
        });

        it('renames the marker via the menu and commits on Enter', () => {
            renderWithTooltip(<MarkerLane pixelsPerBeat={10} scrollX={0} />);
            const lane = screen.getByTestId('lane-surface');
            openMarkerMenu(lane, 100);
            fireEvent.click(screen.getByText('Rename Marker'));
            const input = screen.getByDisplayValue('Intro') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '  Verse  ' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(renameMarker).toHaveBeenCalledWith('m1', 'Verse');
        });

        it('cancels rename on Escape without committing', () => {
            renderWithTooltip(<MarkerLane pixelsPerBeat={10} scrollX={0} />);
            const lane = screen.getByTestId('lane-surface');
            openMarkerMenu(lane, 100);
            fireEvent.click(screen.getByText('Rename Marker'));
            const input = screen.getByDisplayValue('Intro') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Ignore' } });
            fireEvent.keyDown(input, { key: 'Escape' });
            expect(renameMarker).not.toHaveBeenCalled();
        });

        it('enters rename on double-click and does not rename on empty commit', () => {
            const { container } = renderWithTooltip(<MarkerLane pixelsPerBeat={10} scrollX={0} />);
            const markerRow = container.querySelector('[title="Intro"]') as HTMLElement;
            fireEvent.doubleClick(markerRow);
            const input = screen.getByDisplayValue('Intro') as HTMLInputElement;
            fireEvent.change(input, { target: { value: '   ' } });
            fireEvent.blur(input);
            expect(renameMarker).not.toHaveBeenCalled();
        });

        it('dismisses the context menu on an outside mousedown', () => {
            renderWithTooltip(<MarkerLane pixelsPerBeat={10} scrollX={0} />);
            const lane = screen.getByTestId('lane-surface');
            openMarkerMenu(lane, 100);
            expect(screen.getByText('Delete Marker')).toBeInTheDocument();
            // A mousedown on a node outside the menu ref closes it.
            const outside = document.createElement('div');
            document.body.appendChild(outside);
            act(() => {
                outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            });
            expect(screen.queryByText('Delete Marker')).not.toBeInTheDocument();
        });
    });
});

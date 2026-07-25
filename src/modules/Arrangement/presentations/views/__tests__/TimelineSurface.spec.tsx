import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { type Store } from '#/infra/store/types';

import { clipSelectionStore } from '../../../stores/clipSelectionStore';
import { setAutoScroll } from '../../../stores/timelineViewStore';
import { useTimelineInteractions } from '../../hooks/useTimelineInteractions';
import { TimelineSurface } from '../TimelineSurface';

// Capture the zoom/scroll handlers the component registers, so the effect
// callbacks (zoom-to-fit, zoom-to-selection, scroll-to-playhead) can be
// invoked directly rather than through their global event bus.
const zoomHandlers = vi.hoisted(() => ({
    fit: null as null | (() => void),
    selection: null as null | ((range: { startBeat: number; endBeat: number }) => void),
    playhead: null as null | (() => void),
    trackStoreRef: { current: null as null | Store<unknown> },
    timelineViewStoreRef: { current: null as null | Store<unknown> },
    transportStoreRef: { current: null as null | Store<unknown> },
}));

const createReactiveStoreFixture = vi.hoisted(() => {
    return <TData,>({ initialValue }: { initialValue: TData | null }): Store<TData> => {
        let currentValue = initialValue;
        const subscribers = new Set<(value: TData | null) => void>();
        const reactListeners = new Set<() => void>();

        const notify = (): void => {
            for (const subscriber of subscribers) {
                subscriber(currentValue);
            }
            for (const listener of reactListeners) {
                listener();
            }
        };

        const store: Store<TData> = {
            get value(): TData | null {
                return currentValue;
            },
            set(value: TData | null): void {
                currentValue = value;
                notify();
            },
            update(updater: (current: TData | null) => TData | null): void {
                store.set(updater(currentValue));
            },
            clear(): void {
                store.set(null);
            },
            hydrate(): void {},
            subscribe(callback: (value: TData | null) => void): () => void {
                subscribers.add(callback);
                return () => {
                    subscribers.delete(callback);
                };
            },
            subscribeReact(listener: () => void): () => void {
                reactListeners.add(listener);
                return () => {
                    reactListeners.delete(listener);
                };
            },
            getSnapshot(): TData | null {
                return currentValue;
            },
        };

        return store;
    };
});

// Mock external dependencies
vi.mock('../../renderers/createTimelineRenderer', () => ({
    createTimelineRenderer: vi.fn(() =>
        Promise.resolve({
            resize: vi.fn(),
            render: vi.fn(),
            dispose: vi.fn(),
        })
    ),
}));

const renderModelRef = vi.hoisted(() => ({ tracks: [] as Array<{ id: string; height: number }> }));
vi.mock('../../../useCases/buildTimelineRenderModel', () => ({
    buildTimelineRenderModel: vi.fn(() => ({ tracks: renderModelRef.tracks })),
}));

vi.mock('../../../stores/timelineViewStore', () => {
    const store = createReactiveStoreFixture({
        initialValue: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true },
    });
    zoomHandlers.timelineViewStoreRef.current = store;
    return {
        timelineViewStore: store,
        setAutoScroll: vi.fn(),
    };
});

const scheduler = vi.hoisted(() => ({
    loop: null as null | (() => void),
}));
vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn((_id: string, loop: () => void) => {
            scheduler.loop = loop;
        }),
        unregister: vi.fn(),
    },
}));

vi.mock('../ClipContextMenu', () => ({
    ClipContextMenu: ({ onClose }: any) => (
        <div data-testid="clip-menu">
            <button onClick={onClose}>Close</button>
        </div>
    ),
}));

vi.mock('../TimelineEmptyMenu', () => ({
    TimelineEmptyMenu: ({ onClose }: any) => (
        <div data-testid="empty-menu">
            <button onClick={onClose}>Close</button>
        </div>
    ),
}));

vi.mock('../../hooks/useTimelineInteractions', () => ({
    useTimelineInteractions: vi.fn<() => Record<string, unknown>>(() => ({
        handleMouseDown: vi.fn<() => void>(),
        handleMouseMove: vi.fn<() => void>(),
        handleMouseUp: vi.fn<() => void>(),
        handleDoubleClick: vi.fn<() => void>(),
        handleContextMenu: vi.fn<() => void>(),
        handlePointerDown: vi.fn<() => void>(),
        handlePointerMove: vi.fn<() => void>(),
        handlePointerUp: vi.fn<() => void>(),
        handlePointerCancel: vi.fn<() => void>(),
        handleFileDrop: vi.fn<() => void>(),
        getCursor: vi.fn<() => string>(() => 'default'),
        setIsDragOver: vi.fn<() => void>(),
        isDragOver: false,
        isImporting: false,
        rubberBand: null,
        contextMenu: null,
        setContextMenu: vi.fn<() => void>(),
    })),
}));

vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/stores')>()),
    workspaceStore: createReactiveStoreFixture({ initialValue: {} }),
}));

vi.mock('#/modules/Collaboration/presentations/views', () => ({
    PresenceOverlay: (props: Record<string, unknown>) => {
        // Expose the coordinate-mapping callbacks so they can be invoked
        // directly: the real overlay is mocked away, so the beatToX /
        // trackIdToY closures would otherwise never run.
        (globalThis as { __presenceProps?: Record<string, unknown> }).__presenceProps = props;
        return <div data-testid="presence-overlay">Presence</div>;
    },
}));

vi.mock('#/modules/Automation/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/stores')>()),
    automationStore: createReactiveStoreFixture({ initialValue: {} }),
}));

vi.mock('../../../stores/trackStore', () => {
    const store = createReactiveStoreFixture({ initialValue: { tracks: [], selectedTrackId: null } });
    zoomHandlers.trackStoreRef.current = store;
    return { trackStore: store };
});

vi.mock('../../../stores/takeLaneStore', () => ({
    takeLaneStore: createReactiveStoreFixture({ initialValue: { lanes: [] } }),
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/stores')>();
    const store = createReactiveStoreFixture({ initialValue: { isPlaying: false } });
    zoomHandlers.transportStoreRef.current = store;
    return {
        ...actual,
        transportStore: store,
        playheadPositionRef: { current: 0 },
        tempoMapStore: createReactiveStoreFixture({ initialValue: {} }),
        timeSignatureMapStore: createReactiveStoreFixture({ initialValue: {} }),
    };
});

vi.mock('../../../stores/markerStore', () => ({
    markerStore: createReactiveStoreFixture({ initialValue: { markers: [] } }),
}));

vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/WorkspaceShell/useCases')>()),
    onScrollToPlayhead: vi.fn((handler: () => void) => {
        zoomHandlers.playhead = handler;
        return () => {};
    }),
    onZoomToSelection: vi.fn((handler: (range: { startBeat: number; endBeat: number }) => void) => {
        zoomHandlers.selection = handler;
        return () => {};
    }),
    onZoomToFit: vi.fn((handler: () => void) => {
        zoomHandlers.fit = handler;
        return () => {};
    }),
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TimelineSurface', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render canvas element', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('should have correct aria attributes on canvas', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toHaveAttribute('aria-label', 'Timeline editor surface');
    });

    it('should render PresenceOverlay', async () => {
        renderWithTooltip(<TimelineSurface />);
        expect(await screen.findByTestId('presence-overlay')).toBeInTheDocument();
    });

    it('should handle drag over state', () => {
        const mockedUseTimelineInteractions = vi.mocked(useTimelineInteractions);
        mockedUseTimelineInteractions.mockReturnValue({
            handleMouseDown: vi.fn(),
            handleMouseMove: vi.fn(),
            handleMouseUp: vi.fn(),
            handleDoubleClick: vi.fn(),
            handleContextMenu: vi.fn(),
            handlePointerDown: vi.fn(),
            handlePointerMove: vi.fn(),
            handlePointerUp: vi.fn(),
            handlePointerCancel: vi.fn(),
            handleFileDrop: vi.fn(),
            getCursor: vi.fn(() => 'default'),
            setIsDragOver: vi.fn(),
            isDragOver: true,
            isImporting: false,
            rubberBand: null,
            contextMenu: null,
            setContextMenu: vi.fn(),
        });

        renderWithTooltip(<TimelineSurface />);
        expect(screen.getByText('Drop audio or MIDI files here')).toBeInTheDocument();
    });

    it('should handle importing state', () => {
        const mockedUseTimelineInteractions = vi.mocked(useTimelineInteractions);
        mockedUseTimelineInteractions.mockReturnValue({
            handleMouseDown: vi.fn(),
            handleMouseMove: vi.fn(),
            handleMouseUp: vi.fn(),
            handleDoubleClick: vi.fn(),
            handleContextMenu: vi.fn(),
            handlePointerDown: vi.fn(),
            handlePointerMove: vi.fn(),
            handlePointerUp: vi.fn(),
            handlePointerCancel: vi.fn(),
            handleFileDrop: vi.fn(),
            getCursor: vi.fn(() => 'default'),
            setIsDragOver: vi.fn(),
            isDragOver: false,
            isImporting: true,
            rubberBand: null,
            contextMenu: null,
            setContextMenu: vi.fn(),
        });

        renderWithTooltip(<TimelineSurface />);
        expect(screen.getByText('Importing audio…')).toBeInTheDocument();
    });

    it('should have relative flex container', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        expect(container.firstChild).toHaveClass('relative');
        expect(container.firstChild).toHaveClass('flex-1');
    });

    it('should have overflow hidden', () => {
        const { container } = renderWithTooltip(<TimelineSurface />);
        expect(container.firstChild).toHaveClass('overflow-hidden');
    });
});

// Minimal track fixture for the marquee/zoom coverage: only the fields the
// render-model reads (id, kind, height, clips).
const makeTrack = (overrides: Partial<{ id: string; kind: string; height: number }> = {}) =>
    ({
        id: 't1',
        kind: 'midi',
        height: 48,
        clips: [],
        ...overrides,
    }) as never;

describe('TimelineSurface — marquee selection box', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clipSelectionStore.set({
            selectedClipId: null,
            selectedClipIds: [],
            marqueeSelection: null,
        });
    });

    it('renders a marquee box spanning the selected tracks and beat range', () => {
        zoomHandlers.trackStoreRef.current?.set({
            tracks: [makeTrack({ id: 'a', height: 40 }), makeTrack({ id: 'b', height: 60 })],
            selectedTrackId: null,
        });
        zoomHandlers.timelineViewStoreRef.current?.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 10,
            autoScrollEnabled: true,
        });
        clipSelectionStore.set({
            selectedClipId: null,
            selectedClipIds: [],
            marqueeSelection: { startBeat: 2, endBeat: 6, trackIds: ['a', 'b'] },
        });

        const { container } = renderWithTooltip(<TimelineSurface />);
        // The marquee box is the only absolutely-positioned div with a numeric
        // left/top style derived from the selection.
        const marquee = container.querySelector('[style*="left: 20px"]') as HTMLElement | null;
        expect(marquee).not.toBeNull();
        // 40px (track a) + 60px (track b) = 100px tall; left=20px (2 beats * 10ppb).
        expect(marquee!.style.height).toBe('100px');
    });

    it('uses the folder row height (26) for folder tracks within the marquee', () => {
        zoomHandlers.trackStoreRef.current?.set({
            tracks: [makeTrack({ id: 'f', kind: 'folder', height: 80 }), makeTrack({ id: 'b', height: 50 })],
            selectedTrackId: null,
        });
        zoomHandlers.timelineViewStoreRef.current?.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 10,
            autoScrollEnabled: true,
        });
        clipSelectionStore.set({
            selectedClipId: null,
            selectedClipIds: [],
            marqueeSelection: { startBeat: 0, endBeat: 4, trackIds: ['f', 'b'] },
        });

        const { container } = renderWithTooltip(<TimelineSurface />);
        const marquee = container.querySelector('[style*="left: 0px"]') as HTMLElement | null;
        expect(marquee).not.toBeNull();
        // folder collapses to 26 + track b 50 = 76.
        expect(marquee!.style.height).toBe('76px');
    });

    it('renders no marquee box when the selection trackIds match no rendered track', () => {
        zoomHandlers.trackStoreRef.current?.set({
            tracks: [makeTrack({ id: 'a', height: 40 })],
            selectedTrackId: null,
        });
        clipSelectionStore.set({
            selectedClipId: null,
            selectedClipIds: [],
            marqueeSelection: { startBeat: 0, endBeat: 4, trackIds: ['nonexistent'] },
        });
        const { container } = renderWithTooltip(<TimelineSurface />);
        expect(container.querySelector('[style*="left: 0px"]')).toBeNull();
    });
});

describe('TimelineSurface — zoom & scroll handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        zoomHandlers.fit = null;
        zoomHandlers.selection = null;
        zoomHandlers.playhead = null;
    });

    it('zoom-to-fit sets pixelsPerBeat to fit the longest clip content', () => {
        zoomHandlers.trackStoreRef.current?.set({
            tracks: [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })],
            selectedTrackId: null,
        });
        // Give the second track a clip ending at beat 100.
        zoomHandlers.trackStoreRef.current?.set({
            tracks: [
                makeTrack({ id: 'a' }),
                { ...(makeTrack({ id: 'b' }) as object), clips: [{ endBeat: 100 }] } as never,
            ],
            selectedTrackId: null,
        });

        renderWithTooltip(<TimelineSurface />);
        expect(zoomHandlers.fit).not.toBeNull();

        const before = zoomHandlers.timelineViewStoreRef.current?.value as { pixelsPerBeat: number };
        act(() => {
            zoomHandlers.fit!();
        });
        const after = zoomHandlers.timelineViewStoreRef.current?.value as { pixelsPerBeat: number };
        expect(after.pixelsPerBeat).not.toBe(before.pixelsPerBeat);
        // Container width 0 → ppb clamped to the minimum (2).
        expect(after.pixelsPerBeat).toBeGreaterThanOrEqual(2);
    });

    it('zoom-to-fit bails out when there are no tracks', () => {
        zoomHandlers.trackStoreRef.current?.set({ tracks: [], selectedTrackId: null });
        renderWithTooltip(<TimelineSurface />);
        const before = zoomHandlers.timelineViewStoreRef.current?.value as { pixelsPerBeat: number };
        act(() => {
            zoomHandlers.fit!();
        });
        const after = zoomHandlers.timelineViewStoreRef.current?.value as { pixelsPerBeat: number };
        // No tracks → early return, ppb unchanged.
        expect(after.pixelsPerBeat).toBe(before.pixelsPerBeat);
    });

    it('zoom-to-fit bails out when all clips end at or before beat 0', () => {
        zoomHandlers.trackStoreRef.current?.set({
            tracks: [{ ...(makeTrack({ id: 'a' }) as object), clips: [{ endBeat: 0 }] } as never],
            selectedTrackId: null,
        });
        renderWithTooltip(<TimelineSurface />);
        const before = zoomHandlers.timelineViewStoreRef.current?.value as { pixelsPerBeat: number };
        act(() => {
            zoomHandlers.fit!();
        });
        const after = zoomHandlers.timelineViewStoreRef.current?.value as { pixelsPerBeat: number };
        expect(after.pixelsPerBeat).toBe(before.pixelsPerBeat);
    });

    it('zoom-to-selection bails out for a non-positive range', () => {
        renderWithTooltip(<TimelineSurface />);
        const before = zoomHandlers.timelineViewStoreRef.current?.value as { pixelsPerBeat: number };
        act(() => {
            zoomHandlers.selection!({ startBeat: 4, endBeat: 4 });
        });
        const after = zoomHandlers.timelineViewStoreRef.current?.value as { pixelsPerBeat: number };
        expect(after.pixelsPerBeat).toBe(before.pixelsPerBeat);
    });

    it('scroll-to-playhead sets scrollX to keep the playhead centred', () => {
        renderWithTooltip(<TimelineSurface />);
        zoomHandlers.timelineViewStoreRef.current?.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 10,
            autoScrollEnabled: true,
        });
        act(() => {
            zoomHandlers.playhead!();
        });
        const after = zoomHandlers.timelineViewStoreRef.current?.value as { scrollX: number };
        // playheadPx=0 → targetScrollX = max(0, 0 - width/2) = 0.
        expect(after.scrollX).toBeGreaterThanOrEqual(0);
    });
});

describe('TimelineSurface — drag leave & presence overlay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears the drag-over state on drag leave when leaving the container', () => {
        const setIsDragOver = vi.fn();
        vi.mocked(useTimelineInteractions).mockReturnValue({
            handleMouseDown: vi.fn(),
            handleMouseMove: vi.fn(),
            handleMouseUp: vi.fn(),
            handleDoubleClick: vi.fn(),
            handleContextMenu: vi.fn(),
            handlePointerDown: vi.fn(),
            handlePointerMove: vi.fn(),
            handlePointerUp: vi.fn(),
            handlePointerCancel: vi.fn(),
            handleFileDrop: vi.fn(),
            getCursor: vi.fn(() => 'default'),
            setIsDragOver,
            isDragOver: true,
            isImporting: false,
            rubberBand: null,
            contextMenu: null,
            setContextMenu: vi.fn(),
        });
        const { container } = renderWithTooltip(<TimelineSurface />);
        // Drop overlay is shown while isDragOver.
        expect(screen.getByText('Drop audio or MIDI files here')).toBeInTheDocument();
        // Fire a drag leave where currentTarget === target (leaves the container).
        fireEvent.dragLeave(container.firstChild as HTMLElement, {
            currentTarget: container.firstChild,
            target: container.firstChild,
        });
        expect(setIsDragOver).toHaveBeenCalledWith(false);
    });
});

describe('TimelineSurface — presence overlay coordinate callbacks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete (globalThis as { __presenceProps?: unknown }).__presenceProps;
    });

    it('maps a beat to an x pixel via beatToX', () => {
        zoomHandlers.timelineViewStoreRef.current?.set({
            scrollX: 100,
            scrollY: 0,
            pixelsPerBeat: 10,
            autoScrollEnabled: true,
        });
        renderWithTooltip(<TimelineSurface />);
        const props = (globalThis as { __presenceProps?: Record<string, unknown> }).__presenceProps!;
        const beatToX = props.beatToX as (beat: number) => number;
        // beat 10, scrollX 100, ppb 10 → (10 - 100/10) * 10 = (10-10)*10 = 0.
        expect(beatToX(10)).toBe(0);
    });

    it('returns 0 from beatToX when the view store is null', () => {
        zoomHandlers.timelineViewStoreRef.current?.set(null);
        renderWithTooltip(<TimelineSurface />);
        const props = (globalThis as { __presenceProps?: Record<string, unknown> }).__presenceProps!;
        const beatToX = props.beatToX as (beat: number) => number;
        expect(beatToX(5)).toBe(0);
    });

    it('maps a track id to its y pixel via trackIdToY, or null when absent', () => {
        zoomHandlers.timelineViewStoreRef.current?.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 10,
            autoScrollEnabled: true,
        });
        // trackIdToY consumes buildTimelineRenderModel(); populate its tracks.
        renderModelRef.tracks = [
            { id: 'a', height: 40 },
            { id: 'b', height: 60 },
        ];
        renderWithTooltip(<TimelineSurface />);
        const props = (globalThis as { __presenceProps?: Record<string, unknown> }).__presenceProps!;
        const trackIdToY = props.trackIdToY as (trackId: string) => number | null;
        // Track b sits at y offset 40 (track a height).
        expect(trackIdToY('b')).toBe(40);
        // Unknown track id → null.
        expect(trackIdToY('missing')).toBeNull();
        renderModelRef.tracks = [];
    });

    it('returns null from trackIdToY when the view store is null', () => {
        zoomHandlers.timelineViewStoreRef.current?.set(null);
        renderWithTooltip(<TimelineSurface />);
        const props = (globalThis as { __presenceProps?: Record<string, unknown> }).__presenceProps!;
        const trackIdToY = props.trackIdToY as (trackId: string) => number | null;
        expect(trackIdToY('a')).toBeNull();
    });
});

describe('TimelineSurface — transport auto-scroll transition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('enables auto-scroll on the stopped → playing transport transition', () => {
        renderWithTooltip(<TimelineSurface />);
        // Move from stopped to playing: the effect should call setAutoScroll(true).
        act(() => {
            zoomHandlers.transportStoreRef.current?.set({ isPlaying: true });
        });
        expect(vi.mocked(setAutoScroll)).toHaveBeenCalledWith(true);
    });

    it('does not toggle auto-scroll when transport stays stopped', () => {
        renderWithTooltip(<TimelineSurface />);
        act(() => {
            zoomHandlers.transportStoreRef.current?.set({ isPlaying: false });
        });
        expect(vi.mocked(setAutoScroll)).not.toHaveBeenCalled();
    });
});

describe('TimelineSurface — render loop', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        scheduler.loop = null;
    });

    it('auto-scrolls the view when the playhead crosses the right threshold while playing', async () => {
        zoomHandlers.timelineViewStoreRef.current?.set({
            scrollX: 0,
            scrollY: 0,
            pixelsPerBeat: 10,
            autoScrollEnabled: true,
        });
        // Playing with a playhead far past the canvas width → triggers scroll.
        zoomHandlers.transportStoreRef.current?.set({ isPlaying: true });
        const { playheadPositionRef } = await import('#/modules/Transport/stores');
        playheadPositionRef.current = 1000;

        renderWithTooltip(<TimelineSurface />);
        // Wait for the async renderer init to register the render loop.
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });
        expect(scheduler.loop).not.toBeNull();

        const store = zoomHandlers.timelineViewStoreRef.current as Store<{ scrollX: number }>;
        const before = store.value!.scrollX;
        act(() => {
            scheduler.loop!();
        });
        const after = store.value!.scrollX;
        // playheadPx (10000) exceeds the right threshold → scrollX advances.
        expect(after).toBeGreaterThan(before);
    });

    it('marks the model dirty and renders when transport is playing', async () => {
        zoomHandlers.transportStoreRef.current?.set({ isPlaying: true });
        renderWithTooltip(<TimelineSurface />);
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });
        const { buildTimelineRenderModel } = await import('../../../useCases/buildTimelineRenderModel');
        vi.mocked(buildTimelineRenderModel).mockClear();
        act(() => {
            scheduler.loop!();
        });
        // dirty becomes true on the playing frame → render model is built.
        expect(buildTimelineRenderModel).toHaveBeenCalled();
    });
});

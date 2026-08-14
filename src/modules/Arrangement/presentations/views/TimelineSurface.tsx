import { type ReactElement, useRef, useEffect, lazy, Suspense } from 'react';

import { useStore } from '#/infra/store/useStore';
import { TRACK_HEIGHT_VALUES } from '#/modules/Preferences/useCases';
import { transportStore, playheadPositionRef, tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';
import { onZoomToFit, onZoomToSelection, onScrollToPlayhead } from '#/modules/WorkspaceShell/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { type TimelineRenderer } from '../../models/RendererBackend';
import { previewDirtyFlag } from '../../stores/clipDragPreviewRef';
import { clipSelectionStore, defaultClipSelectionState } from '../../stores/clipSelectionStore';
import { markerStore } from '../../stores/markerStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { setAutoScroll, timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { useTimelineInteractions } from '../hooks/useTimelineInteractions';
import { createTimelineRenderer } from '../renderers/createTimelineRenderer';

import { ClipContextMenu } from './ClipContextMenu';
import { TimelineEmptyMenu } from './TimelineEmptyMenu';

const PresenceOverlayLazy = lazy(() =>
    import('#/modules/Collaboration/presentations/views').then((module) => ({
        default: module.PresenceOverlay,
    }))
);

export const TimelineSurface = (): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<TimelineRenderer | null>(null);

    const clipSelection = useStore(clipSelectionStore, defaultClipSelectionState);
    const marqueeSelection = clipSelection.marqueeSelection;
    const currentViewStore = useStore(timelineViewStore, {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 20,
        autoScrollEnabled: true,
    });
    const currentTrackStore = useStore(trackStore, { tracks: [], selectedTrackId: null });

    const {
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleDoubleClick,
        handleContextMenu,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handlePointerCancel,
        handleFileDrop,
        getCursor,
        setIsDragOver,
        isDragOver,
        isImporting,
        rubberBand,
        contextMenu,
        setContextMenu,
    } = useTimelineInteractions(canvasRef);

    const closeContextMenu = () => setContextMenu(null);

    const marqueeStyle = (() => {
        if (!marqueeSelection || !currentViewStore || !currentTrackStore) {
            return null;
        }

        const pixelsPerBeat = currentViewStore.pixelsPerBeat;
        const scrollX = currentViewStore.scrollX;
        const scrollY = currentViewStore.scrollY ?? 0;

        const left = Math.max(0, marqueeSelection.startBeat * pixelsPerBeat - scrollX);
        const width = (marqueeSelection.endBeat - marqueeSelection.startBeat) * pixelsPerBeat;

        let topTrackIdx = -1;
        let bottomTrackIdx = -1;

        for (const [idx, track] of currentTrackStore.tracks.entries()) {
            if (marqueeSelection.trackIds.includes(track.id)) {
                if (topTrackIdx === -1 || idx < topTrackIdx) {
                    topTrackIdx = idx;
                }
                if (idx > bottomTrackIdx) {
                    bottomTrackIdx = idx;
                }
            }
        }

        if (topTrackIdx === -1) {
            return null;
        }

        let trackYOffset = 0;
        let top = 0;
        let bottom = 0;

        for (let i = 0; i <= bottomTrackIdx; i++) {
            const track = currentTrackStore.tracks[i];
            if (!track) {
                continue;
            }

            // Mirror buildTimelineRenderModel.ts:162 / the renderer's row layout:
            // folders collapse to a fixed 26px and every other track uses its own
            // resizable height. Using a single constant here misaligned the
            // marquee box against the rendered rows (#32-new).
            const rowHeight = track.kind === 'folder' ? 26 : track.height;

            if (i === topTrackIdx) {
                top = trackYOffset;
            }
            if (i === bottomTrackIdx) {
                bottom = trackYOffset + rowHeight;
            }

            trackYOffset += rowHeight;
        }

        return {
            left,
            top: top - scrollY,
            width,
            height: bottom - top,
        };
    })();

    useEffect(() => {
        const handleZoomToFit = () => {
            const container = containerRef.current;
            if (!container) {
                return;
            }
            const state = trackStore.value;
            if (!state || state.tracks.length === 0) {
                return;
            }

            let maxEndBeat = 0;
            for (const track of state.tracks) {
                for (const clip of track.clips) {
                    if (clip.endBeat > maxEndBeat) {
                        maxEndBeat = clip.endBeat;
                    }
                }
            }

            if (maxEndBeat <= 0) {
                return;
            }

            const padding = maxEndBeat * 0.05;
            const totalBeats = maxEndBeat + padding;
            const canvasWidth = container.getBoundingClientRect().width;
            const ppb = Math.max(2, Math.min(80, canvasWidth / totalBeats));

            const current = timelineViewStore.value;
            timelineViewStore.set({
                scrollX: 0,
                scrollY: current?.scrollY ?? 0,
                pixelsPerBeat: ppb,
                autoScrollEnabled: current?.autoScrollEnabled ?? true,
                viewportHeight: current?.viewportHeight ?? 0,
            });
        };

        const handleZoomToSelection = ({ startBeat, endBeat }: { startBeat: number; endBeat: number }) => {
            const container = containerRef.current;
            if (!container) {
                return;
            }
            const range = endBeat - startBeat;
            if (range <= 0) {
                return;
            }

            const paddedRange = range * 1.2;
            const canvasWidth = container.getBoundingClientRect().width;
            const ppb = Math.max(2, Math.min(80, canvasWidth / paddedRange));
            const paddingBeats = range * 0.1;
            const scrollX = Math.max(0, (startBeat - paddingBeats) * ppb);

            const current = timelineViewStore.value;
            timelineViewStore.set({
                scrollX,
                scrollY: current?.scrollY ?? 0,
                pixelsPerBeat: ppb,
                autoScrollEnabled: current?.autoScrollEnabled ?? true,
                viewportHeight: current?.viewportHeight ?? 0,
            });
        };

        const handleScrollToPlayhead = () => {
            const container = containerRef.current;
            if (!container) {
                return;
            }
            const transport = transportStore.value;
            const viewState = timelineViewStore.value;
            if (!transport || !viewState) {
                return;
            }
            const playheadPx = playheadPositionRef.current * viewState.pixelsPerBeat;
            const canvasWidth = container.getBoundingClientRect().width;
            const targetScrollX = Math.max(0, playheadPx - canvasWidth / 2);
            timelineViewStore.set({ ...viewState, scrollX: targetScrollX });
        };

        const unsubs = [
            onZoomToFit(handleZoomToFit),
            onZoomToSelection(handleZoomToSelection),
            onScrollToPlayhead(handleScrollToPlayhead),
        ];
        return () => {
            for (const unsub of unsubs) {
                unsub();
            }
        };
    }, []);

    useEffect(() => {
        // Only re-enable auto-scroll on the stopped → playing transition.
        // Forcing it true on every transport tick (tempo, playhead, etc.) while
        // already playing defeated a user-initiated setAutoScroll(false) made by
        // manually scrolling horizontally during playback.
        let wasPlaying = transportStore.value?.isPlaying ?? false;
        const unsubscribe = transportStore.subscribe(() => {
            const transport = transportStore.value;
            if (!transport) {
                return;
            }
            if (transport.isPlaying && !wasPlaying) {
                setAutoScroll(true);
            }
            wasPlaying = transport.isPlaying;
        });
        return unsubscribe;
    }, []);

    // NOTE: pinch/gesture handling (gesturestart/change/end) is owned solely by
    // useTimelineGestures (invoked via useTimelineInteractions). A duplicate
    // listener block previously lived here too, so each Safari `gesturechange`
    // fired zoomTimeline(delta * 2) twice → 2x zoom (NEW-bug). Do not re-add it.

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return undefined;
        }

        let disposed = false;
        let dirty = true;
        const renderId = crypto.randomUUID();

        const markDirty = () => {
            dirty = true;
        };

        const unsubTransport = transportStore.subscribe(markDirty);
        const unsubView = timelineViewStore.subscribe(markDirty);
        const unsubTracks = trackStore.subscribe(markDirty);
        const unsubWorkspace = clipSelectionStore.subscribe(markDirty);
        const unsubMarkers = markerStore.subscribe(markDirty);
        const unsubTempoMap = tempoMapStore.subscribe(markDirty);
        const unsubTimeSigMap = timeSignatureMapStore.subscribe(markDirty);
        const unsubTakeLanes = takeLaneStore.subscribe(markDirty);

        const initRenderer = async () => {
            const renderer = await createTimelineRenderer(canvas);

            if (disposed) {
                renderer.dispose();
                return;
            }

            rendererRef.current = renderer;

            const rect = container.getBoundingClientRect();
            renderer.resize(rect.width, rect.height);

            const renderLoop = () => {
                if (disposed) {
                    return;
                }

                const transport = transportStore.value;
                const isPlaying = transport?.isPlaying ?? false;

                if (isPlaying) {
                    dirty = true;
                }

                if (previewDirtyFlag.value) {
                    previewDirtyFlag.value = false;
                    dirty = true;
                }

                if (dirty) {
                    dirty = false;

                    const viewState = timelineViewStore.value;
                    if (isPlaying && viewState?.autoScrollEnabled) {
                        const playheadPx = playheadPositionRef.current * viewState.pixelsPerBeat;
                        // audit M-013: measure the viewport in CSS pixels, the
                        // same unit scrollX and playheadPx use. `canvas.width`
                        // is the DEVICE-pixel backing store (both renderers set
                        // it to CSS width × devicePixelRatio), so reading it
                        // here inflated the threshold by the dpr: at dpr 2 it
                        // sat at 150% of the viewport and the playhead ran off
                        // screen before follow-playhead ever fired. Use the
                        // container's CSS box, as the zoom/scroll handlers above
                        // already do.
                        const viewportWidth = container.getBoundingClientRect().width;
                        const rightThreshold = viewState.scrollX + viewportWidth * 0.75;
                        const leftEdge = viewState.scrollX;

                        if (playheadPx > rightThreshold || playheadPx < leftEdge) {
                            const targetScrollX = Math.max(0, playheadPx - viewportWidth * 0.25);
                            timelineViewStore.set({ ...viewState, scrollX: targetScrollX });
                        }
                    }

                    const model = buildTimelineRenderModel();
                    renderer.render(model);
                }
            };

            animationScheduler.register(`timeline-${renderId}`, renderLoop);
        };

        // Async renderer setup inside an effect. A rejection (e.g. WebGPU init
        // failing) leaves the canvas blank, so it is surfaced rather than dropped.
        initRenderer().catch((error: unknown) => {
            console.error('Failed to initialize timeline renderer', error);
        });

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                rendererRef.current?.resize(width, height);
            }
            // Immediately re-render after resize to prevent a 1-frame flash.
            // Setting canvas.width/height clears all pixel data, but the dirty
            // flag would only trigger a redraw on the NEXT animation frame,
            // leaving the canvas blank for one frame.
            if (rendererRef.current) {
                const model = buildTimelineRenderModel();
                rendererRef.current.render(model);
                dirty = false;
            }
        });
        resizeObserver.observe(container);

        return () => {
            disposed = true;
            animationScheduler.unregister(`timeline-${renderId}`);
            resizeObserver.disconnect();
            rendererRef.current?.dispose();
            rendererRef.current = null;
            unsubTransport();
            unsubView();
            unsubTracks();
            unsubWorkspace();
            unsubMarkers();
            unsubTempoMap();
            unsubTimeSigMap();
            unsubTakeLanes();
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative flex-1 overflow-hidden"
            onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setIsDragOver(true);
            }}
            onDragLeave={(e) => {
                if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDragOver(false);
                }
            }}
            onDrop={handleFileDrop}
        >
            {isDragOver ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-primary/10 border-2 border-dashed border-primary pointer-events-none"
                >
                    <span className="text-sm font-medium text-primary">Drop audio or MIDI files here</span>
                    <span className="text-xs text-primary/60">WAV, MP3, FLAC, AIFF, OGG, MIDI</span>
                </div>
            ) : null}
            {isImporting ? (
                <div
                    role="status"
                    aria-live="polite"
                    className="absolute inset-0 z-20 flex items-center justify-center bg-surface-base/60 pointer-events-none"
                >
                    <div className="daw-floating-surface flex items-center gap-2 rounded-md px-4 py-2">
                        {/* Decorative spinner: only animate when the user has not
                            requested reduced motion (prefers-reduced-motion). */}
                        <div className="size-4 motion-safe:animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <span className="text-sm font-medium text-foreground">Importing audio…</span>
                    </div>
                </div>
            ) : null}
            <canvas
                ref={canvasRef}
                className="absolute inset-0 touch-none"
                style={{ cursor: getCursor() }}
                aria-label="Timeline editor surface"
                aria-description="Arrangement timeline showing tracks, clips, and playhead position. Scroll to pan, Ctrl+scroll to zoom. Click to set playhead. Click clips to select. Double-click clip to edit."
                tabIndex={0}
                onMouseDown={(e) => {
                    closeContextMenu();
                    handleMouseDown(e);
                }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
            />

            <Suspense fallback={null}>
                <PresenceOverlayLazy
                    beatToX={(beat) => {
                        const view = timelineViewStore.value;
                        if (!view) {
                            return 0;
                        }
                        return (beat - view.scrollX / view.pixelsPerBeat) * view.pixelsPerBeat;
                    }}
                    trackIdToY={(trackId) => {
                        const model = buildTimelineRenderModel();
                        const view = timelineViewStore.value;
                        if (!model || !view) {
                            return null;
                        }
                        const scrollY = view.scrollY ?? 0;
                        let y = 0;
                        for (const track of model.tracks) {
                            if (track.id === trackId) {
                                return y - scrollY;
                            }
                            y += track.height;
                        }
                        return null;
                    }}
                    trackHeight={TRACK_HEIGHT_VALUES.normal}
                />
            </Suspense>

            {rubberBand ? (
                <div
                    className="absolute border border-[var(--color-accent-cyan)]/60 bg-[var(--color-accent-cyan)]/10 pointer-events-none z-10"
                    style={{
                        left: Math.min(rubberBand.startX, rubberBand.endX),
                        top: Math.min(rubberBand.startY, rubberBand.endY),
                        width: Math.abs(rubberBand.endX - rubberBand.startX),
                        height: Math.abs(rubberBand.endY - rubberBand.startY),
                    }}
                />
            ) : null}

            {marqueeStyle ? (
                <div
                    className="absolute border border-primary/60 bg-primary/10 pointer-events-none z-10"
                    style={marqueeStyle}
                />
            ) : null}

            {contextMenu?.kind === 'clip' ? (
                <ClipContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    clipId={contextMenu.clipId}
                    splitBeat={contextMenu.splitBeat}
                    onClose={closeContextMenu}
                />
            ) : null}
            {contextMenu?.kind === 'empty' ? (
                <TimelineEmptyMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    trackId={contextMenu.trackId}
                    beat={contextMenu.beat}
                    onClose={closeContextMenu}
                />
            ) : null}
        </div>
    );
};

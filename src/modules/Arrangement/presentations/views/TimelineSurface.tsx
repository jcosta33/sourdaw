import { type ReactElement, useRef, useEffect, useMemo } from 'react';

import { useStore } from '#/infra/store/useStore';
import { automationStore } from '#/modules/Automation/stores';
import { PresenceOverlay } from '#/modules/Collaboration/presentations/views';
import { transportStore, playheadPositionRef, tempoMapStore, timeSignatureMapStore } from '#/modules/Transport/stores';
import { workspaceStore, defaultWorkspaceState } from '#/modules/Workspace/stores';
import { TRACK_HEIGHT_VALUES, onZoomToFit, onZoomToSelection, onScrollToPlayhead } from '#/modules/Workspace/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';
import { type GestureEvent } from '#/utils/DOM/GestureEvent';

import { type TimelineRenderer } from '../../models/RendererBackend';
import { previewDirtyFlag } from '../../stores/clipDragPreviewRef';
import { markerStore } from '../../stores/markerStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { zoomTimeline, setAutoScroll, timelineViewStore } from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { buildTimelineRenderModel } from '../../useCases/buildTimelineRenderModel';
import { initTimelineRenderer } from '../../useCases/initTimelineRenderer';
import { useTimelineInteractions } from '../hooks/useTimelineInteractions';
import { createWebGpuAutomationRenderer, type AutomationRenderer } from '../renderers/createWebGpuAutomationRenderer';

import { ClipContextMenu } from './ClipContextMenu';
import { TimelineEmptyMenu } from './TimelineEmptyMenu';

export const TimelineSurface = (): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const autoCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<TimelineRenderer | null>(null);
    const autoRendererRef = useRef<AutomationRenderer | null>(null);

    const workspaceState = useStore(workspaceStore, defaultWorkspaceState);
    const marqueeSelection = workspaceState.marqueeSelection;
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

    const marqueeStyle = useMemo(() => {
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

            if (i === topTrackIdx) {
                top = trackYOffset;
            }
            if (i === bottomTrackIdx) {
                bottom = trackYOffset + TRACK_HEIGHT_VALUES.normal; // Note: Assumes normal height for now, but model.tracks has actual height
            }

            // To get accurate track heights, we ideally use the render model, but since we're in React land,
            // assuming normal height is a fallback. A better way is using TRACK_HEIGHT_VALUES[workspaceState.channelStripWidth or similar]
            // But for now let's just use the default height as a simple approximation if we can't get it.
            trackYOffset += TRACK_HEIGHT_VALUES.normal;
        }

        return {
            left,
            top: top - scrollY,
            width,
            height: bottom - top,
        };
    }, [marqueeSelection, currentViewStore, currentTrackStore]);

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
        const unsubscribe = transportStore.subscribe(() => {
            const transport = transportStore.value;
            if (!transport) {
                return;
            }
            if (transport.isPlaying) {
                setAutoScroll(true);
            }
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }

        let lastScale = 1;

        const onGestureStart = (e: Event) => {
            e.preventDefault();
            lastScale = 1;
        };

        const onGestureChange = (e: Event) => {
            e.preventDefault();
            const ge = e as GestureEvent;
            const delta = ge.scale - lastScale;
            lastScale = ge.scale;
            zoomTimeline(delta * 2);
        };

        const onGestureEnd = (e: Event) => {
            e.preventDefault();
        };

        canvas.addEventListener('gesturestart', onGestureStart, { passive: false });
        canvas.addEventListener('gesturechange', onGestureChange, { passive: false });
        canvas.addEventListener('gestureend', onGestureEnd, { passive: false });

        return () => {
            canvas.removeEventListener('gesturestart', onGestureStart);
            canvas.removeEventListener('gesturechange', onGestureChange);
            canvas.removeEventListener('gestureend', onGestureEnd);
        };
    }, []);

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
        const unsubAutomation = automationStore.subscribe(markDirty);
        const unsubWorkspace = workspaceStore.subscribe(markDirty);
        const unsubMarkers = markerStore.subscribe(markDirty);
        const unsubTempoMap = tempoMapStore.subscribe(markDirty);
        const unsubTimeSigMap = timeSignatureMapStore.subscribe(markDirty);
        const unsubTakeLanes = takeLaneStore.subscribe(markDirty);

        const initRenderer = async () => {
            const renderer = await initTimelineRenderer(canvas);
            const autoRenderer = autoCanvasRef.current
                ? await createWebGpuAutomationRenderer(autoCanvasRef.current)
                : null;

            if (disposed) {
                renderer.dispose();
                autoRenderer?.dispose();
                return;
            }

            rendererRef.current = renderer;
            autoRendererRef.current = autoRenderer;

            const rect = container.getBoundingClientRect();
            renderer.resize(rect.width, rect.height);
            if (autoCanvasRef.current) {
                autoCanvasRef.current.width = rect.width;
                autoCanvasRef.current.height = rect.height;
            }

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
                        const canvasWidth = canvas.width;
                        const rightThreshold = viewState.scrollX + canvasWidth * 0.75;
                        const leftEdge = viewState.scrollX;

                        if (playheadPx > rightThreshold || playheadPx < leftEdge) {
                            const targetScrollX = Math.max(0, playheadPx - canvasWidth * 0.25);
                            timelineViewStore.set({ ...viewState, scrollX: targetScrollX });
                        }
                    }

                    const model = buildTimelineRenderModel();
                    renderer.render(model);

                    if (autoRendererRef.current) {
                        const view = timelineViewStore.value;
                        const autoState = automationStore.value;
                        if (view && autoState) {
                            const lanes = autoState.lanes
                                .filter((l) => l.visible && !l.collapsed)
                                .map((l) => {
                                    let y = -view.scrollY;
                                    for (const t of model.tracks) {
                                        if (t.id === l.trackId) {
                                            break;
                                        }
                                        y += t.height;
                                    }
                                    return {
                                        points: l.points,
                                        ghostPoints: l.ghostPoints,
                                        y,
                                        height: 64, // Default height approximation
                                        color: l.color || '#a78bfa',
                                        minValue: l.minValue,
                                        maxValue: l.maxValue,
                                    };
                                });
                            autoRendererRef.current.render({
                                lanes,
                                viewportStartBeat: view.scrollX / view.pixelsPerBeat,
                                pixelsPerBeat: view.pixelsPerBeat,
                                width: canvas.width,
                                height: canvas.height,
                            });
                        }
                    }
                }
            };

            animationScheduler.register(`timeline-${renderId}`, renderLoop);
        };

        void initRenderer();

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
            unsubAutomation();
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
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-primary/10 border-2 border-dashed border-primary pointer-events-none">
                    <span className="text-sm font-medium text-primary">Drop audio or MIDI files here</span>
                    <span className="text-xs text-primary/60">WAV, MP3, FLAC, AIFF, OGG, MIDI</span>
                </div>
            ) : null}
            {isImporting ? (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface-base/60 pointer-events-none">
                    <div className="daw-floating-surface flex items-center gap-2 rounded-md px-4 py-2">
                        <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
            <canvas ref={autoCanvasRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />

            <PresenceOverlay
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

import { type ReactElement, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent, type DragEvent as ReactDragEvent, useRef, useEffect, useState } from "react";

interface GestureEvent extends UIEvent {
    readonly scale: number;
    readonly rotation: number;
}
import { createCanvasRenderer } from "../../repositories/createCanvasRenderer";
import { createWebGpuRenderer } from "../../repositories/createWebGpuRenderer";
import { getPreferredRendererBackend, type TimelineRenderer } from "../../models/RendererBackend";
import { buildTimelineRenderModel } from "../../useCases/buildTimelineRenderModel";
import { zoomTimeline, scrollTimeline, setAutoScroll, setScrollY, timelineViewStore } from "../../stores/timelineViewStore";
import {
    setPlayheadFromClick,
    beginClipDrag,
    commitClipDrag,
    hitTestClip,
    hitTestTrack,
    hitTestClipEdge,
    snapToGrid,
    snapToGridOrClips,
    getTrackAtY,
    type DragState,
} from "../../useCases/timelineInteractions";
import { selectTrack } from "#/modules/Track/useCases/toggleTrackState";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import { setWorkspaceMode } from "#/modules/Workspace/useCases/setWorkspaceMode";
import { splitClip, trimClipStart, trimClipEnd } from "#/modules/Track/useCases/clipEditingUseCases";
import { addClip, removeClip, duplicateClip, duplicateClipToNextBar, moveClipPreview, moveClip } from "#/modules/Track/useCases/clipUseCases";
import { copySelectedClip, cutSelectedClip, pasteClip } from "#/modules/Track/useCases/clipboardUseCases";
import { normalizeClip, reverseClip, lockClip, setClipColor, renameClip, muteClip } from "#/modules/Track/useCases/clipEditingUseCases";
import { detectTempo } from "#/modules/AiRuntime/useCases/tempoDetection";
import { detectKey } from "#/modules/AiRuntime/useCases/keyDetection";
import { notifyUser } from "#/helpers/Notification/notifyUser";
import { stripSilence } from "#/modules/Track/useCases/stripSilence";
import { addMarker, setMarkerColor, removeMarker as removeMarkerUseCase } from "#/modules/Timeline/useCases/markerUseCases";
import { exportMidiClip } from "#/modules/Track/useCases/exportMidiFile";
import { decodeAudioFile } from "#/modules/AudioEngine/useCases/decodeAudioFile";
import { importMidiFile } from "#/modules/Track/useCases/importMidiFile";
import { addTrack } from "#/modules/Track/useCases/addTrack";
import { addDevice } from "#/modules/Track/useCases/deviceUseCases";
import { addAutomationPoint, addAutomationLane } from "#/modules/Track/useCases/automationUseCases";
import type { AutomationPoint } from "#/modules/Track/models/Automation";
import { automationStore } from "#/modules/Track/stores/automationStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { takeLaneStore } from "#/modules/Track/stores/takeLaneStore";
import { setLoopRegion } from "#/modules/Transport/useCases/transportControls";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { tempoMapStore } from "#/modules/Transport/stores/tempoMapStore";
import { timeSignatureMapStore } from "#/modules/Transport/stores/timeSignatureMapStore";
import { markerStore } from "#/modules/Timeline/stores/markerStore";
import { pushUndoEntry } from "#/modules/Command/useCases/pushUndoEntry";
import { executeAppAction } from "#/modules/Command/useCases/executeAppAction";
import { removeAutomationPoint, batchAddAutomationPoints } from "#/modules/Track/useCases/automationUseCases";

type ClipMenuState = {
    kind: "clip";
    x: number;
    y: number;
    clipId: string;
    trackId: string;
    splitBeat: number;
};

type EmptyMenuState = {
    kind: "empty";
    x: number;
    y: number;
    trackId: string | null;
    beat: number;
};

type ContextMenuState = ClipMenuState | EmptyMenuState | null;

const RULER_HEIGHT = 24;

export const TimelineSurface = (): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<TimelineRenderer | null>(null);
    const rafRef = useRef<number>(0);
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
    const pointersRef = useRef<Map<number, PointerEvent>>(new Map());
    const loopDragRef = useRef<{ startBeat: number } | null>(null);
    const autoDragRef = useRef<{ laneId: string; trackId: string; points: AutomationPoint[] } | null>(null);
    const drawDragRef = useRef<{ trackId: string; startBeat: number; clipType: "audio" | "midi" } | null>(null);
    const [rubberBand, setRubberBand] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
    const rubberBandRef = useRef<{ startX: number; startY: number } | null>(null);

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
            timelineViewStore.set({ scrollX: 0, scrollY: current?.scrollY ?? 0, pixelsPerBeat: ppb, autoScrollEnabled: current?.autoScrollEnabled ?? true });
        };

        const handleZoomToSelection = (e: Event) => {
            const container = containerRef.current;
            if (!container) {
                return;
            }
            const { startBeat, endBeat } = (e as CustomEvent<{ startBeat: number; endBeat: number }>).detail;
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
            timelineViewStore.set({ scrollX, scrollY: current?.scrollY ?? 0, pixelsPerBeat: ppb, autoScrollEnabled: current?.autoScrollEnabled ?? true });
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
            const playheadPx = transport.playheadPosition * viewState.pixelsPerBeat;
            const canvasWidth = container.getBoundingClientRect().width;
            const targetScrollX = Math.max(0, playheadPx - canvasWidth / 2);
            timelineViewStore.set({ ...viewState, scrollX: targetScrollX });
        };

        document.addEventListener("webdaw:zoom-to-fit", handleZoomToFit);
        document.addEventListener("webdaw:zoom-to-selection", handleZoomToSelection);
        document.addEventListener("webdaw:scroll-to-playhead", handleScrollToPlayhead);
        return () => {
            document.removeEventListener("webdaw:zoom-to-fit", handleZoomToFit);
            document.removeEventListener("webdaw:zoom-to-selection", handleZoomToSelection);
            document.removeEventListener("webdaw:scroll-to-playhead", handleScrollToPlayhead);
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
            return;
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

        canvas.addEventListener("gesturestart", onGestureStart, { passive: false });
        canvas.addEventListener("gesturechange", onGestureChange, { passive: false });
        canvas.addEventListener("gestureend", onGestureEnd, { passive: false });

        return () => {
            canvas.removeEventListener("gesturestart", onGestureStart);
            canvas.removeEventListener("gesturechange", onGestureChange);
            canvas.removeEventListener("gestureend", onGestureEnd);
        };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        let disposed = false;
        let dirty = true;

        const markDirty = () => { dirty = true; };

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
            const backend = getPreferredRendererBackend();
            let renderer: TimelineRenderer | null = null;

            if (backend === "webgpu") {
                renderer = await createWebGpuRenderer(canvas);
            }

            if (!renderer) {
                renderer = createCanvasRenderer(canvas);
            }

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

                if (dirty) {
                    dirty = false;

                    const viewState = timelineViewStore.value;
                    if (isPlaying && viewState?.autoScrollEnabled) {
                        const playheadPx = transport!.playheadPosition * viewState.pixelsPerBeat;
                        const canvasWidth = canvas.width;
                        const rightThreshold = viewState.scrollX + canvasWidth * 0.75;
                        const leftEdge = viewState.scrollX;

                        if (playheadPx > rightThreshold || playheadPx < leftEdge) {
                            const targetScrollX = Math.max(0, playheadPx - canvasWidth * 0.25);
                            timelineViewStore.set({ ...viewState, scrollX: targetScrollX });
                        }
                    }

                    const model = buildTimelineRenderModel();
                    renderer!.render(model);
                }

                rafRef.current = requestAnimationFrame(renderLoop);
            };

            rafRef.current = requestAnimationFrame(renderLoop);
        };

        initRenderer();

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                rendererRef.current?.resize(width, height);
            }
            markDirty();
        });
        resizeObserver.observe(container);

        return () => {
            disposed = true;
            cancelAnimationFrame(rafRef.current);
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

    const handleWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            const isPinch = Math.abs(e.deltaY) < 10;
            const zoomFactor = isPinch ? -e.deltaY * 0.02 : -e.deltaY * 0.005;
            zoomTimeline(zoomFactor);
        } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            scrollTimeline(e.deltaX || e.deltaY);
            const transport = transportStore.value;
            if (transport?.isPlaying) {
                setAutoScroll(false);
            }
        } else {
            const currentY = timelineViewStore.value?.scrollY ?? 0;
            setScrollY(Math.max(0, currentY + e.deltaY));
        }
    };

    const getCanvasCoords = (e: ReactMouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const getBeatFromX = (x: number): number => {
        const viewState = timelineViewStore.value;
        if (!viewState) return 0;
        return (x / viewState.pixelsPerBeat) + (viewState.scrollX / viewState.pixelsPerBeat);
    };

    const getActiveTool = () => workspaceStore.value?.activeTool ?? "select";

    const handleMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0) return;
        const { x, y } = getCanvasCoords(e);
        const tool = getActiveTool();

        if (y < RULER_HEIGHT) {
            if (e.shiftKey || e.altKey) {
                const beat = getBeatFromX(x);
                loopDragRef.current = { startBeat: beat };
                return;
            }
            setPlayheadFromClick(x);
            return;
        }

        if (tool === "cut") {
            const hit = hitTestClip(x, y);
            if (hit) {
                const beat = getBeatFromX(x);
                const state = trackStore.value;
                const origClip = state?.tracks.flatMap((t) => t.clips).find((c) => c.id === hit.clipId);
                if (origClip) {
                    const savedClip = { ...origClip };
                    splitClip(hit.clipId, beat);
                    const afterState = trackStore.value;
                    const newClips = afterState?.tracks
                        .flatMap((t) => t.clips)
                        .filter((c) => c.id !== hit.clipId && (c.startBeat === savedClip.startBeat || c.startBeat === beat) && c.endBeat <= savedClip.endBeat && c.startBeat >= savedClip.startBeat) ?? [];
                    const newClipIds = newClips.map((c) => c.id);
                    pushUndoEntry(
                        "Split clip",
                        () => {
                            for (const id of newClipIds) { removeClip(id); }
                            addClip({ trackId: savedClip.trackId, startBeat: savedClip.startBeat, endBeat: savedClip.endBeat, name: savedClip.name, type: savedClip.type, audioBufferId: savedClip.audioBufferId });
                        },
                        () => splitClip(hit.clipId, beat),
                    );
                }
            }
            return;
        }

        if (tool === "draw") {
            const trackId = hitTestTrack(y);
            if (trackId) {
                const beat = getBeatFromX(x);
                const track = trackStore.value?.tracks.find((t) => t.id === trackId);
                const clipType = track?.kind === "midi" ? "midi" : "audio";
                drawDragRef.current = { trackId, startBeat: Math.floor(beat), clipType: clipType as "audio" | "midi" };
                selectTrack(trackId);
            }
            return;
        }

        if (tool === "automation") {
            const trackId = hitTestTrack(y);
            if (trackId) {
                const beat = getBeatFromX(x);
                const contentY = y - RULER_HEIGHT + (timelineViewStore.value?.scrollY ?? 0);
                const tracks = trackStore.value?.tracks ?? [];
                const trackHit = getTrackAtY(tracks, contentY);
                const trackHeight = trackHit ? (tracks[trackHit.index]?.height ?? 64) : 64;
                const trackOffset = trackHit ? tracks.slice(0, trackHit.index).reduce((sum, t) => sum + (t.height ?? 64), 0) : 0;
                const trackLocalY = contentY - trackOffset;
                const value = Math.max(0, Math.min(1, 1 - (trackLocalY / trackHeight)));

                const autoState = automationStore.value;
                let lane = autoState?.lanes.find((l) => l.trackId === trackId && l.parameterId === "gain");
                if (!lane) {
                    addAutomationLane(trackId, "gain", "Gain");
                    lane = automationStore.value?.lanes.find((l) => l.trackId === trackId && l.parameterId === "gain");
                }
                if (lane) {
                    const point: AutomationPoint = { beat, value, curve: "linear" };
                    addAutomationPoint(lane.id, point);
                    autoDragRef.current = { laneId: lane.id, trackId, points: [point] };
                }
                selectTrack(trackId);
            }
            return;
        }

        const clipHit = hitTestClip(x, y);
        if (clipHit) {
            selectTrack(clipHit.trackId);
            const ws = workspaceStore.value;
            if (ws) {
                if (e.shiftKey || e.metaKey) {
                    const ids = new Set(ws.selectedClipIds);
                    if (ids.has(clipHit.clipId)) {
                        ids.delete(clipHit.clipId);
                    } else {
                        ids.add(clipHit.clipId);
                    }
                    workspaceStore.set({ ...ws, selectedClipId: clipHit.clipId, selectedClipIds: [...ids] });
                } else {
                    workspaceStore.set({ ...ws, selectedClipId: clipHit.clipId, selectedClipIds: [clipHit.clipId] });
                }
            }
        }

        const edgeHit = hitTestClipEdge(x, y);
        let dragMode: "move" | "stretch" | "trim-start" = tool === "stretch" ? "stretch" : "move";
        if (edgeHit && tool === "select") {
            if (edgeHit.edge === "left") dragMode = "trim-start";
            else if (edgeHit.edge === "right") dragMode = "stretch";
        }

        const drag = beginClipDrag(x, y, dragMode);
        if (drag) {
            setDragState(drag);
            return;
        }

        if (!clipHit) {
            const trackId = hitTestTrack(y);
            if (trackId) {
                selectTrack(trackId);
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipId: null, selectedClipIds: [] });
                }
            }
            rubberBandRef.current = { startX: x, startY: y };
            setPlayheadFromClick(x);
            return;
        }
    };

    const handleMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        if (!dragState && !loopDragRef.current && !autoDragRef.current && !drawDragRef.current && !rubberBandRef.current) {
            const tool = getActiveTool();
            if (tool === "select") {
                const { x, y } = getCanvasCoords(e);
                const edgeHit = hitTestClipEdge(x, y);
                if (edgeHit && (edgeHit.edge === "left" || edgeHit.edge === "right")) {
                    setHoverCursor("ew-resize");
                } else {
                    setHoverCursor(null);
                }
            } else {
                setHoverCursor(null);
            }
        }

        if (loopDragRef.current) {
            const { x } = getCanvasCoords(e);
            const currentBeat = getBeatFromX(x);
            const startBeat = loopDragRef.current.startBeat;
            const loopStart = Math.min(startBeat, currentBeat);
            const loopEnd = Math.max(startBeat, currentBeat);
            if (loopEnd - loopStart > 0.25) {
                setLoopRegion(Math.floor(loopStart), Math.ceil(loopEnd));
                const state = transportStore.value;
                if (state && !state.isLooping) {
                    transportStore.set({ ...state, isLooping: true });
                }
            }
            return;
        }

        if (autoDragRef.current) {
            const { x, y } = getCanvasCoords(e);
            const beat = getBeatFromX(x);
            const contentY = y - RULER_HEIGHT + (timelineViewStore.value?.scrollY ?? 0);
            const tracks = trackStore.value?.tracks ?? [];
            const trackHit = getTrackAtY(tracks, contentY);
            const trackHeight = trackHit ? (tracks[trackHit.index]?.height ?? 64) : 64;
            const trackOffset = trackHit ? tracks.slice(0, trackHit.index).reduce((sum, t) => sum + (t.height ?? 64), 0) : 0;
            const trackLocalY = contentY - trackOffset;
            const value = Math.max(0, Math.min(1, 1 - (trackLocalY / trackHeight)));

            const lastPoint = autoDragRef.current.points[autoDragRef.current.points.length - 1];
            if (!lastPoint || Math.abs(beat - lastPoint.beat) >= 0.1) {
                const point: AutomationPoint = { beat, value, curve: "linear" };
                autoDragRef.current.points.push(point);
                addAutomationPoint(autoDragRef.current.laneId, point);
            }
            return;
        }

        if (drawDragRef.current) return;

        if (rubberBandRef.current) {
            const { x: mx, y: my } = getCanvasCoords(e);
            const dx = Math.abs(mx - rubberBandRef.current.startX);
            const dy = Math.abs(my - rubberBandRef.current.startY);
            if (dx > 4 || dy > 4) {
                setRubberBand({ startX: rubberBandRef.current.startX, startY: rubberBandRef.current.startY, endX: mx, endY: my });
            }
            return;
        }

        if (!dragState) return;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = "grabbing";

        const { x: mx, y: my } = getCanvasCoords(e);
        const viewState = timelineViewStore.value;
        if (!viewState) return;

        const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
        const rawBeat = (mx / viewState.pixelsPerBeat) + viewportStartBeat;

        if (dragState.mode === "trim-start") {
            const snappedBeat = Math.min(dragState.endBeat - 0.25, snapToGrid(rawBeat));
            trimClipStart(dragState.clipId, Math.max(0, snappedBeat));
            return;
        }

        if (dragState.mode === "stretch") {
            const snappedBeat = Math.max(dragState.startBeat + 0.25, snapToGrid(rawBeat));
            trimClipEnd(dragState.clipId, snappedBeat);
            return;
        }

        const contentY = my - RULER_HEIGHT + (timelineViewStore.value?.scrollY ?? 0);
        const tracks = trackStore.value?.tracks;
        if (!tracks) return;
        const trackHit = getTrackAtY(tracks, Math.max(0, contentY));
        const targetTrack = trackHit ? tracks[trackHit.index] : null;
        const snapTrackId = targetTrack?.id ?? dragState.sourceTrackId;
        const snappedBeat = Math.max(0, snapToGridOrClips(rawBeat - dragState.offsetBeat, snapTrackId, dragState.clipId));
        if (targetTrack) {
            const ws = workspaceStore.value;
            const selectedIds = ws?.selectedClipIds ?? [];
            if (selectedIds.length > 1 && selectedIds.includes(dragState.clipId)) {
                const state = trackStore.value;
                if (state) {
                    const primaryClip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === dragState.clipId);
                    if (primaryClip) {
                        const beatDelta = snappedBeat - primaryClip.startBeat;
                        for (const id of selectedIds) {
                            const clip = state.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
                            if (clip) {
                                moveClipPreview(id, targetTrack.id, Math.max(0, snapToGridOrClips(clip.startBeat + beatDelta, targetTrack.id, id)));
                            }
                        }
                    }
                }
            } else {
                moveClipPreview(dragState.clipId, targetTrack.id, snappedBeat);
            }
        }
    };

    const handleMouseUp = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        if (loopDragRef.current) {
            loopDragRef.current = null;
            return;
        }

        if (autoDragRef.current) {
            const { laneId, points: drawnPoints } = autoDragRef.current;
            if (drawnPoints.length > 0) {
                const savedPoints = drawnPoints.map((p) => ({ ...p }));
                pushUndoEntry(
                    `Draw ${savedPoints.length} automation point${savedPoints.length > 1 ? "s" : ""}`,
                    () => { for (const p of savedPoints) { removeAutomationPoint(laneId, p.beat); } },
                    () => { batchAddAutomationPoints(laneId, savedPoints); },
                );
            }
            autoDragRef.current = null;
            return;
        }

        if (drawDragRef.current) {
            const { x } = getCanvasCoords(e);
            const endBeat = Math.ceil(getBeatFromX(x));
            const startBeat = drawDragRef.current.startBeat;
            const s = Math.min(startBeat, endBeat);
            const en = Math.max(startBeat, endBeat);
            const length = Math.max(1, en - s);
            const drawTrackId = drawDragRef.current.trackId;
            const drawClipType = drawDragRef.current.clipType;
            const clip = addClip({
                trackId: drawTrackId,
                startBeat: s,
                endBeat: s + length,
                name: `Clip ${s}`,
                type: drawClipType,
            });
            if (clip) {
                const clipId = clip.id;
                pushUndoEntry(
                    "Draw clip",
                    () => removeClip(clipId),
                    () => addClip({ trackId: drawTrackId, startBeat: s, endBeat: s + length, name: `Clip ${s}`, type: drawClipType }),
                );
            }
            drawDragRef.current = null;
            return;
        }

        if (rubberBandRef.current && rubberBand) {
            const model = buildTimelineRenderModel();
            const viewState = timelineViewStore.value;
            if (viewState && model) {
                const left = Math.min(rubberBand.startX, rubberBand.endX);
                const right = Math.max(rubberBand.startX, rubberBand.endX);
                const sY = viewState.scrollY ?? 0;
                const top = Math.min(rubberBand.startY, rubberBand.endY) - RULER_HEIGHT + sY;
                const bottom = Math.max(rubberBand.startY, rubberBand.endY) - RULER_HEIGHT + sY;

                const viewportStartBeat = viewState.scrollX / viewState.pixelsPerBeat;
                const leftBeat = (left / viewState.pixelsPerBeat) + viewportStartBeat;
                const rightBeat = (right / viewState.pixelsPerBeat) + viewportStartBeat;

                const allTracks = trackStore.value?.tracks ?? [];
                const hitIds: string[] = [];
                let trackYOffset = 0;

                for (let ti = 0; ti < model.tracks.length; ti++) {
                    const perTrackHeight = allTracks[ti]?.height ?? model.trackHeight;
                    const trackTop = trackYOffset;
                    const trackBottom = trackYOffset + perTrackHeight;
                    trackYOffset += perTrackHeight;
                    if (trackBottom < top || trackTop > bottom) {
                        continue;
                    }
                    for (const clip of model.tracks[ti]!.clips) {
                        if (clip.endBeat > leftBeat && clip.startBeat < rightBeat) {
                            hitIds.push(clip.id);
                        }
                    }
                }

                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({
                        ...ws,
                        selectedClipId: hitIds[0] ?? null,
                        selectedClipIds: hitIds,
                    });
                }
            }
            rubberBandRef.current = null;
            setRubberBand(null);
            return;
        }
        rubberBandRef.current = null;
        setRubberBand(null);

        if (dragState) {
            const { x, y } = getCanvasCoords(e);
            const origStart = dragState.startBeat;
            const origEnd = dragState.endBeat;
            const origTrackId = dragState.sourceTrackId;
            const dragClipId = dragState.clipId;
            const dragMode = dragState.mode;

            commitClipDrag(dragState, x, y);

            const afterClip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === dragClipId);
            if (afterClip) {
                const newStart = afterClip.startBeat;
                const newEnd = afterClip.endBeat;
                const newTrackId = afterClip.trackId;
                const changed = newStart !== origStart || newEnd !== origEnd || newTrackId !== origTrackId;

                if (changed) {
                    if (dragMode === "move") {
                        pushUndoEntry(
                            "Move clip",
                            () => moveClip(dragClipId, origTrackId, origStart),
                            () => moveClip(dragClipId, newTrackId, newStart),
                        );
                    } else if (dragMode === "trim-start") {
                        pushUndoEntry(
                            "Trim clip start",
                            () => trimClipStart(dragClipId, origStart),
                            () => trimClipStart(dragClipId, newStart),
                        );
                    } else if (dragMode === "stretch") {
                        pushUndoEntry(
                            "Trim clip end",
                            () => trimClipEnd(dragClipId, origEnd),
                            () => trimClipEnd(dragClipId, newEnd),
                        );
                    }
                }
            }

            setDragState(null);
            const canvas = canvasRef.current;
            if (canvas) canvas.style.cursor = "";
        }
    };

    const [hoverCursor, setHoverCursor] = useState<string | null>(null);

    const getCursor = (): string => {
        if (hoverCursor) return hoverCursor;
        const tool = getActiveTool();
        switch (tool) {
            case "cut": return "crosshair";
            case "draw": return "cell";
            case "automation": return "crosshair";
            case "stretch": return "ew-resize";
            default: return "default";
        }
    };

    const [isDragOver, setIsDragOver] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const getDragCoords = (e: ReactDragEvent<HTMLDivElement>): { x: number; y: number } => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const isAudioFile = (file: File): boolean => {
        if (file.type.startsWith("audio/")) return true;
        const ext = file.name.toLowerCase().split(".").pop() ?? "";
        return ["wav", "mp3", "ogg", "flac", "aac", "m4a", "webm", "aiff", "aif"].includes(ext);
    };

    const isMidiFile = (file: File): boolean => {
        if (file.type === "audio/midi" || file.type === "audio/x-midi") return true;
        const ext = file.name.toLowerCase().split(".").pop() ?? "";
        return ["mid", "midi"].includes(ext);
    };

    const handleFileDrop = async (e: ReactDragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragOver(false);

        const { x, y } = getDragCoords(e);
        const trackHit = hitTestTrack(y);
        const beat = Math.max(0, Math.floor(getBeatFromX(x)));

        const sampleData = e.dataTransfer.getData("application/x-webdaw-sample");
        if (sampleData) {
            try {
                const sample = JSON.parse(sampleData) as { name: string; id: string; duration: string; durationSeconds?: number; audioBufferId?: string };
                let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                if (!targetTrackId) {
                    const newTrack = addTrack({ name: sample.name, kind: "audio" });
                    if (!newTrack) {
                        return;
                    }
                    targetTrackId = newTrack.id;
                }
                const durationBeats = sample.durationSeconds
                    ? Math.max(1, Math.ceil(sample.durationSeconds * 2))
                    : sample.duration.includes("bar") ? parseInt(sample.duration) * 4 : 4;
                addClip({ trackId: targetTrackId, startBeat: beat, endBeat: beat + durationBeats, name: sample.name, type: "audio", audioBufferId: sample.audioBufferId });
            } catch { /* invalid data */ }
            return;
        }

        const pluginData = e.dataTransfer.getData("application/x-webdaw-plugin");
        if (pluginData) {
            try {
                const plugin = JSON.parse(pluginData) as { name: string; id: string };
                const targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;
                if (targetTrackId) {
                    addDevice(targetTrackId, plugin.name);
                }
            } catch { /* invalid data */ }
            return;
        }

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) {
            return;
        }

        setIsImporting(true);
        let currentBeat = beat;
        try {
            for (const file of files) {
                if (isMidiFile(file)) {
                    await importMidiFile(file);
                    continue;
                }

                if (!isAudioFile(file)) {
                    continue;
                }

                try {
                    const { id: bufferId, buffer } = await decodeAudioFile(file);
                    const model = buildTimelineRenderModel();
                    const durationBeats = Math.max(4, Math.ceil((buffer.duration / 60) * model.tempo));

                    let targetTrackId = trackHit ?? trackStore.value?.selectedTrackId;

                    if (!targetTrackId) {
                        const newTrack = addTrack({ name: file.name.replace(/\.[^.]+$/, ""), kind: "audio" });
                        if (!newTrack) {
                            return;
                        }
                        targetTrackId = newTrack.id;
                    }

                    addClip({
                        trackId: targetTrackId,
                        startBeat: currentBeat,
                        endBeat: currentBeat + durationBeats,
                        name: file.name.replace(/\.[^.]+$/, ""),
                        type: "audio",
                        audioBufferId: bufferId,
                    });

                    currentBeat += durationBeats;
                } catch {
                    document.dispatchEvent(new CustomEvent("webdaw:notify", {
                        detail: { message: `Failed to import "${file.name}" — unsupported format or corrupt file`, level: "error" },
                    }));
                }
            }
        } finally {
            setIsImporting(false);
        }
    };

    const handleDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        const { x, y } = getCanvasCoords(e);
        if (y < RULER_HEIGHT) return;
        const hit = hitTestClip(x, y);
        if (hit) {
            selectTrack(hit.trackId);
            const ws = workspaceStore.value;
            if (ws) {
                workspaceStore.set({ ...ws, selectedClipId: hit.clipId });
            }
            setWorkspaceMode("clip");
        }
    };

    const handleContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const { x, y } = getCanvasCoords(e);
        if (y < RULER_HEIGHT) return;

        const hit = hitTestClip(x, y);
        if (hit) {
            selectTrack(hit.trackId);
            const ws = workspaceStore.value;
            if (ws) {
                workspaceStore.set({ ...ws, selectedClipId: hit.clipId });
            }
            setContextMenu({
                kind: "clip",
                x: e.clientX,
                y: e.clientY,
                clipId: hit.clipId,
                trackId: hit.trackId,
                splitBeat: getBeatFromX(x),
            });
        } else {
            const trackId = hitTestTrack(y);
            setContextMenu({
                kind: "empty",
                x: e.clientX,
                y: e.clientY,
                trackId,
                beat: Math.floor(getBeatFromX(x)),
            });
        }
    };

    const closeContextMenu = () => setContextMenu(null);

    return (
        <div
            ref={containerRef}
            className="relative flex-1 overflow-hidden"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setIsDragOver(true); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
            onDrop={handleFileDrop}
        >
            {isDragOver && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-primary/10 border-2 border-dashed border-primary pointer-events-none">
                    <span className="text-sm font-medium text-primary">Drop audio or MIDI files here</span>
                    <span className="text-xs text-primary/60">WAV, MP3, FLAC, AIFF, OGG, MIDI</span>
                </div>
            )}
            {isImporting && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-surface-base/60 pointer-events-none">
                    <div className="flex items-center gap-2 rounded-md bg-surface-raised px-4 py-2 shadow-lg border border-border">
                        <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <span className="text-sm font-medium text-foreground">Importing audio…</span>
                    </div>
                </div>
            )}
            <canvas
                ref={canvasRef}
                className="absolute inset-0 touch-none"
                style={{ cursor: getCursor() }}
                aria-label="Timeline editor surface"
                aria-description="Arrangement timeline showing tracks, clips, and playhead position. Scroll to pan, Ctrl+scroll to zoom. Click to set playhead. Click clips to select. Double-click clip to edit."
                tabIndex={0}
                onWheel={handleWheel}
                onMouseDown={(e) => { closeContextMenu(); handleMouseDown(e); }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                onPointerDown={(e) => {
                    pointersRef.current.set(e.pointerId, e.nativeEvent);
                }}
                onPointerMove={(e) => {
                    if (pointersRef.current.size === 2) {
                        const prev = pointersRef.current.get(e.pointerId);
                        pointersRef.current.set(e.pointerId, e.nativeEvent);
                        if (!prev) return;

                        const [p1, p2] = [...pointersRef.current.values()];
                        if (!p1 || !p2) return;

                        const prevOther = [...pointersRef.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
                        if (!prevOther) return;

                        const prevDist = Math.hypot(prev.clientX - prevOther.clientX, prev.clientY - prevOther.clientY);
                        const currDist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
                        const delta = currDist - prevDist;

                        if (Math.abs(delta) > 1) {
                            zoomTimeline(delta > 0 ? 2 : -2);
                        }
                    } else {
                        pointersRef.current.set(e.pointerId, e.nativeEvent);
                    }
                }}
                onPointerUp={(e) => {
                    pointersRef.current.delete(e.pointerId);
                }}
                onPointerCancel={(e) => {
                    pointersRef.current.delete(e.pointerId);
                }}
            />

            {rubberBand && (
                <div
                    className="absolute border border-blue-400/60 bg-blue-400/10 pointer-events-none z-10"
                    style={{
                        left: Math.min(rubberBand.startX, rubberBand.endX),
                        top: Math.min(rubberBand.startY, rubberBand.endY),
                        width: Math.abs(rubberBand.endX - rubberBand.startX),
                        height: Math.abs(rubberBand.endY - rubberBand.startY),
                    }}
                />
            )}

            {contextMenu?.kind === "clip" && (
                <ClipContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    clipId={contextMenu.clipId}
                    splitBeat={contextMenu.splitBeat}
                    onClose={closeContextMenu}
                />
            )}
            {contextMenu?.kind === "empty" && (
                <TimelineEmptyMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    trackId={contextMenu.trackId}
                    beat={contextMenu.beat}
                    onClose={closeContextMenu}
                />
            )}
        </div>
    );
};

const menuBtnClass = "flex w-full items-center px-3 py-1.5 text-xs hover:bg-accent text-left";
const menuSep = "my-1 border-t border-border/50";
const menuShortcut = "ml-auto pl-4 text-muted-foreground";

const useContextMenuDismiss = (ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) => {
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [ref, onClose]);
};

const ClipContextMenu = ({
    x,
    y,
    clipId,
    splitBeat,
    onClose,
}: {
    x: number;
    y: number;
    clipId: string;
    splitBeat: number;
    onClose: () => void;
}): ReactElement => {
    const menuRef = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(menuRef, onClose);

    const clip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    const isMidi = clip?.type === "midi";
    const isAudio = clip?.type === "audio";
    const isLocked = clip?.locked ?? false;
    const isMuted = clip?.muted ?? false;
    const selectedIds = workspaceStore.value?.selectedClipIds ?? [];
    const multiSelected = selectedIds.length > 1 && selectedIds.includes(clipId);

    const act = (fn: () => void) => () => { fn(); onClose(); };

    const deleteSelected = () => {
        if (multiSelected) {
            for (const id of selectedIds) {
                removeClip(id);
            }
        } else {
            removeClip(clipId);
        }
    };

    const duplicateSelected = () => {
        if (multiSelected) {
            for (const id of selectedIds) {
                duplicateClip(id);
            }
        } else {
            duplicateClip(clipId);
        }
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[180px] max-h-[80vh] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
            style={{ left: x, top: y }}
            role="menu"
        >
            {multiSelected && (
                <div className="px-3 py-1 text-[10px] text-muted-foreground">{selectedIds.length} clips selected</div>
            )}
            <button className={menuBtnClass} role="menuitem" onClick={act(() => {
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipId: clipId });
                }
                setWorkspaceMode("clip");
            })}>
                Edit Clip
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={() => {
                const currentClip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
                const newName = window.prompt("Rename clip:", currentClip?.name ?? "");
                if (newName !== null && newName.trim()) {
                    renameClip(clipId, newName.trim());
                }
                onClose();
            }}>
                Rename Clip
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={act(() => {
                const origClip = trackStore.value?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
                if (origClip) {
                    const savedClip = { ...origClip };
                    splitClip(clipId, splitBeat);
                    const afterState = trackStore.value;
                    const newClipIds = afterState?.tracks
                        .flatMap((t) => t.clips)
                        .filter((c) => c.id !== clipId && c.startBeat >= savedClip.startBeat && c.endBeat <= savedClip.endBeat)
                        .map((c) => c.id) ?? [];
                    pushUndoEntry(
                        "Split clip",
                        () => {
                            for (const id of newClipIds) { removeClip(id); }
                            addClip({ trackId: savedClip.trackId, startBeat: savedClip.startBeat, endBeat: savedClip.endBeat, name: savedClip.name, type: savedClip.type, audioBufferId: savedClip.audioBufferId });
                        },
                        () => splitClip(clipId, splitBeat),
                    );
                }
            })}>
                Split at Cursor
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={act(duplicateSelected)}>
                Duplicate{multiSelected ? ` (${selectedIds.length})` : ""} <span className={menuShortcut}>⌘D</span>
            </button>
            {!multiSelected && (
                <button className={menuBtnClass} role="menuitem" onClick={act(() => duplicateClipToNextBar(clipId))}>
                    Duplicate to Next Bar <span className={menuShortcut}>⌥D</span>
                </button>
            )}
            <div className={menuSep} />
            <button className={menuBtnClass} role="menuitem" onClick={act(() => {
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipId: clipId });
                }
                copySelectedClip();
            })}>
                Copy <span className={menuShortcut}>⌘C</span>
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={act(() => {
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipId: clipId });
                }
                cutSelectedClip();
            })}>
                Cut <span className={menuShortcut}>⌘X</span>
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={act(() => pasteClip())}>
                Paste <span className={menuShortcut}>⌘V</span>
            </button>
            <div className={menuSep} />
            {isAudio && (
                <>
                    <button className={menuBtnClass} role="menuitem" onClick={act(() => normalizeClip(clipId))}>
                        Normalize
                    </button>
                    <button className={menuBtnClass} role="menuitem" onClick={act(() => reverseClip(clipId))}>
                        Reverse
                    </button>
                    <button className={menuBtnClass} role="menuitem" onClick={act(() => stripSilence(clipId))}>
                        Strip Silence
                    </button>
                    <button className={menuBtnClass} role="menuitem" onClick={act(() => {
                        if (clip?.audioBufferId) {
                            const bpm = detectTempo(clip.audioBufferId);
                            if (bpm) {
                                notifyUser(`Detected tempo: ${bpm} BPM`);
                            } else {
                                notifyUser("Could not detect tempo");
                            }
                        }
                    })}>
                        Detect Tempo
                    </button>
                    <button className={menuBtnClass} role="menuitem" onClick={act(() => {
                        if (clip?.audioBufferId) {
                            const result = detectKey(clip.audioBufferId);
                            if (result) {
                                const conf = Math.round(result.confidence * 100);
                                notifyUser(`Detected key: ${result.key} ${result.mode} (${conf}% confidence)`);
                            } else {
                                notifyUser("Could not detect key");
                            }
                        }
                    })}>
                        Detect Key
                    </button>
                </>
            )}
            {isMidi && (
                <>
                    <button className={menuBtnClass} role="menuitem" onClick={act(() => executeAppAction({ type: "arpeggiate", payload: { clipId } }))}>
                        Arpeggiate
                    </button>
                    <button className={menuBtnClass} role="menuitem" onClick={act(() => exportMidiClip(clipId))}>
                        Export as MIDI…
                    </button>
                </>
            )}
            <button className={menuBtnClass} role="menuitem" onClick={act(() => muteClip(clipId, !isMuted))}>
                {isMuted ? "Unmute Clip" : "Mute Clip"}
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={act(() => lockClip(clipId, !isLocked))}>
                {isLocked ? "Unlock Clip" : "Lock Clip"}
            </button>
            <div className={menuSep} />
            <div className="px-3 py-1 text-[10px] text-muted-foreground">Color</div>
            <div className="flex gap-1 px-3 py-1">
                {["", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"].map((c) => (
                    <button
                        key={c || "default"}
                        className="size-4 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                        style={{ backgroundColor: c || "var(--color-muted)" }}
                        onClick={act(() => setClipColor(clipId, c))}
                        aria-label={c || "Default color"}
                    />
                ))}
            </div>
            <div className={menuSep} />
            <button className={`${menuBtnClass} text-destructive hover:bg-destructive/10`} role="menuitem" onClick={act(deleteSelected)}>
                Delete{multiSelected ? ` (${selectedIds.length})` : ""} <span className={menuShortcut}>⌫</span>
            </button>
        </div>
    );
};

const TimelineEmptyMenu = ({
    x,
    y,
    trackId,
    beat,
    onClose,
}: {
    x: number;
    y: number;
    trackId: string | null;
    beat: number;
    onClose: () => void;
}): ReactElement => {
    const menuRef = useRef<HTMLDivElement>(null);
    useContextMenuDismiss(menuRef, onClose);

    const act = (fn: () => void) => () => { fn(); onClose(); };

    const handleImportAudio = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*,.wav,.mp3,.ogg,.flac,.aac,.m4a,.aiff";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                return;
            }
            try {
                const result = await decodeAudioFile(file);
                const targetTrackId = trackId ?? (() => {
                    addTrack({ name: file.name.replace(/\.[^.]+$/, ""), kind: "audio" });
                    return trackStore.value?.tracks[trackStore.value.tracks.length - 1]?.id ?? "";
                })();
                const durationBeats = Math.ceil((result.buffer.duration / 60) * (transportStore.value?.tempo ?? 120));
                addClip({ trackId: targetTrackId, startBeat: beat, endBeat: beat + durationBeats, name: file.name.replace(/\.[^.]+$/, ""), audioBufferId: result.id });
            } catch {
                document.dispatchEvent(new CustomEvent("webdaw:notify", {
                    detail: { message: `Failed to import "${file.name}" — unsupported format or corrupt file`, level: "error" },
                }));
            }
        };
        input.click();
        onClose();
    };

    const handleImportMidi = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".mid,.midi";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (file) {
                await importMidiFile(file);
            }
        };
        input.click();
        onClose();
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover py-1 shadow-lg"
            style={{ left: x, top: y }}
            role="menu"
        >
            <button className={menuBtnClass} role="menuitem" onClick={act(() => addTrack({ name: "Audio", kind: "audio" }))}>
                Add Audio Track
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={act(() => addTrack({ name: "MIDI", kind: "midi" }))}>
                Add MIDI Track
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={act(() => addTrack({ name: "Bus", kind: "bus" }))}>
                Add Bus Track
            </button>
            <div className={menuSep} />
            {trackId && (
                <button className={menuBtnClass} role="menuitem" onClick={act(() => {
                    const track = trackStore.value?.tracks.find((t) => t.id === trackId);
                    const clipType = track?.kind === "midi" ? "midi" : "audio";
                    addClip({ trackId, startBeat: beat, endBeat: beat + 4, name: `New ${clipType} clip` });
                })}>
                    Add Clip Here
                </button>
            )}
            <button className={menuBtnClass} role="menuitem" onClick={act(() => pasteClip())}>
                Paste <span className={menuShortcut}>⌘V</span>
            </button>
            <div className={menuSep} />
            <button className={menuBtnClass} role="menuitem" onClick={act(() => addMarker(beat, `Marker at ${beat}`))}>
                Add Marker Here
            </button>
            <NearbyMarkerColorMenu beat={beat} onClose={onClose} />
            <div className={menuSep} />
            <button className={menuBtnClass} role="menuitem" onClick={handleImportAudio}>
                Import Audio…
            </button>
            <button className={menuBtnClass} role="menuitem" onClick={handleImportMidi}>
                Import MIDI…
            </button>
        </div>
    );
};

const MARKER_COLOR_PRESETS = ["oklch(0.7 0.15 200)", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

const NearbyMarkerColorMenu = ({ beat, onClose }: { beat: number; onClose: () => void }): ReactElement | null => {
    const markers = markerStore.value?.markers ?? [];
    const nearby = markers.filter((m) => Math.abs(m.beat - beat) <= 2);
    if (nearby.length === 0) return null;

    const act = (fn: () => void) => () => { fn(); onClose(); };

    return (
        <>
            {nearby.map((marker) => (
                <div key={marker.id}>
                    <div className={menuSep} />
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">
                        Marker: {marker.name}
                    </div>
                    <div className="flex gap-1 px-3 py-1">
                        {MARKER_COLOR_PRESETS.map((c) => (
                            <button
                                key={c}
                                className="size-4 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                                style={{
                                    backgroundColor: c,
                                    outline: c === marker.color ? "2px solid white" : "none",
                                    outlineOffset: "1px",
                                }}
                                onClick={act(() => setMarkerColor(marker.id, c))}
                                aria-label={`Set marker color`}
                            />
                        ))}
                    </div>
                    <button className={`${menuBtnClass} text-destructive hover:bg-destructive/10`} role="menuitem" onClick={act(() => removeMarkerUseCase(marker.id))}>
                        Remove Marker
                    </button>
                </div>
            ))}
        </>
    );
};
